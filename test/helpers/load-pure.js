/* ============================================================
   load-pure.js — loads the pure region of a browser script so it can
   be unit tested under node.

   The site ships no build step and no module system: every .js file is
   an ordinary <script> that runs against the DOM. Rather than bolt a
   bundler onto a zero-dependency repo, or dirty production files with
   `module.exports` guards that exist only for tests, each source file
   marks the block that is genuinely free of DOM, storage and network
   with sentinel comments:

     /* @pure-start *\/  ...  /* @pure-end *\/

   This reads that block and evaluates it in isolation. If someone later
   reaches for `document` inside the markers, the test that covers it
   fails immediately with a ReferenceError — which is the point.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const START = '/* @pure-start';
const END = '/* @pure-end */';

/**
 * @param {string} relativePath  e.g. 'blogs.js'
 * @param {string[]} names       identifiers to pull out of the pure block
 * @returns {Record<string, Function|any>}
 */
function loadPure(relativePath, names) {
  const file = path.join(ROOT, relativePath);
  const src = fs.readFileSync(file, 'utf8');

  const startIdx = src.indexOf(START);
  const endIdx = src.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`${relativePath} has no @pure-start/@pure-end block`);
  }
  if (endIdx < startIdx) {
    throw new Error(`${relativePath} has @pure-end before @pure-start`);
  }

  // Skip past the end of the opening sentinel comment itself.
  const bodyStart = src.indexOf('*/', startIdx) + 2;
  const body = src.slice(bodyStart, endIdx);

  /* Evaluated in this realm rather than a vm context, so the objects it
     returns are ordinary host objects and assert.deepEqual compares them
     normally. `document`, `window` and `localStorage` simply do not
     exist under node, so touching one inside the pure block still throws
     a ReferenceError — which is exactly the guarantee we want. */
  const factory = new Function(`${body}\nreturn { ${names.join(', ')} };`);
  const exported = factory();
  for (const name of names) {
    if (exported[name] === undefined) {
      throw new Error(`${relativePath} pure block does not define ${name}`);
    }
  }
  return exported;
}

module.exports = { loadPure, ROOT };
