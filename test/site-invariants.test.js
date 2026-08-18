/* ============================================================
   site-invariants.test.js — checks the properties of the built site
   that are easy to break by accident and impossible to notice by
   looking at a page.

   These are the things this specific site can silently regress on:

     - A future inline <script> will simply not run. Every page's CSP is
       script-src 'self' with no unsafe-inline, so the browser blocks it
       and the only symptom is a feature quietly not working.
     - A third-party <script> or stylesheet re-introduces an origin the
       CSP forbids, so it is blocked — or worse, someone widens the CSP
       to allow it and the policy stops meaning anything.
     - An <img> pointed at a master image. logo.jpeg is 1024x1024 and
       exists only for the social card.
     - A renamed or deleted asset leaves a 404 that nothing catches.
     - The performance budget in the README drifts with no enforcement.

   Everything here reads the files on disk. No browser, no network.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ROOT } = require('./helpers/load-pure');

/* ---- budget (mirrors the table in README.md) ---- */
const BUDGET = {
  maxRequestsFirstLoad: 10,
  maxHomepageTransferKB: 150,
  maxImageKB: 20,
  maxPageScriptKB: 40,      // excludes assets/vendor
  thirdPartyOrigins: 0,
};

function htmlFiles() {
  const out = [];
  for (const dir of ['.', 'blogs', 'dictionary', 'dictionary/terms']) {
    const abs = path.join(ROOT, dir);
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.html')) out.push(path.join(dir, f).replace(/\\/g, '/'));
    }
  }
  return out;
}

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sizeKB = p => fs.statSync(path.join(ROOT, p)).size / 1024;
const gzipKB = p => zlib.gzipSync(fs.readFileSync(path.join(ROOT, p)), { level: 9 }).length / 1024;

/* ---- CSP integrity ---- */

test('every page ships a Content-Security-Policy', () => {
  for (const f of htmlFiles()) {
    assert.match(read(f), /http-equiv="Content-Security-Policy"/,
      `${f} has no CSP meta tag`);
  }
});

test('no page has an inline <script> — the CSP would block it', () => {
  for (const f of htmlFiles()) {
    const src = read(f);
    /* application/ld+json is data, not script; the CSP does not execute
       it and browsers do not run it. */
    const inline = src.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g) || [];
    assert.equal(inline.length, 0,
      `${f} has ${inline.length} inline <script> block(s); the CSP forbids inline script, so it will not run. Move it to a .js file.`);
  }
});

test('no page has an inline event handler — the CSP would block it', () => {
  /* The sibling test above catches inline <script> blocks, but an
     onclick="" attribute is inline script too and was slipping through:
     the formula sheet's print button sat dead behind script-src 'self'
     for a whole release because nothing asserted on this. */
  const offenders = [];
  for (const f of htmlFiles()) {
    const handlers = read(f).match(/\son[a-z]+\s*=\s*"[^"]*"/gi) || [];
    for (const h of handlers) offenders.push(`${f} ->${h.trim()}`);
  }
  assert.equal(offenders.length, 0,
    `inline event handlers found; the CSP forbids them, so they never fire. Bind them in a .js file instead:\n  ${offenders.join('\n  ')}`);
});

test('no page loads a subresource from a third-party origin', () => {
  const offenders = [];
  for (const f of htmlFiles()) {
    const src = read(f);
    const refs = [...src.matchAll(/<(?:script|link|img|source|iframe)[^>]*(?:src|href|srcset)="(https?:\/\/[^"]+)"/g)];
    for (const [, url] of refs) {
      if (!url.startsWith('https://thehallucinatedlab.space')) offenders.push(`${f} -> ${url}`);
    }
  }
  assert.equal(offenders.length, BUDGET.thirdPartyOrigins,
    `third-party subresources found:\n  ${offenders.join('\n  ')}`);
});

test('no CSP grants unsafe-inline or unsafe-eval to script-src', () => {
  for (const f of htmlFiles()) {
    const m = read(f).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(m, `${f} CSP unreadable`);
    const scriptSrc = m[1].split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
    assert.ok(scriptSrc, `${f} CSP has no script-src`);
    assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/,
      `${f} script-src has been widened to "${scriptSrc}"`);
  }
});

/* The test above only guards script-src, which is how 40 dictionary pages
   shipped with https://fonts.googleapis.com in style-src and
   https://fonts.gstatic.com in font-src. A CSP that names an origin the
   site never requests is standing permission for nothing, and [GAP-02]
   already makes this policy weaker than a header would be. Loopback is
   the one legitimate remote: [RULE-02] tools talk to the user's own
   Python package over 127.0.0.1/localhost. */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:(\d+|\*))?$/;

test('no CSP directive grants a third-party origin', () => {
  const offenders = [];
  for (const f of htmlFiles()) {
    const m = read(f).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(m, `${f} CSP unreadable`);
    for (const directive of m[1].split(';')) {
      const [name, ...values] = directive.trim().split(/\s+/);
      if (!name) continue;
      for (const v of values) {
        if (!/^https?:\/\//.test(v)) continue;
        if (LOOPBACK.test(v)) continue;
        offenders.push(`${f} -> ${name} ${v}`);
      }
    }
  }
  assert.equal(offenders.length, BUDGET.thirdPartyOrigins,
    `CSP grants a third-party origin; the site is same-origin only:\n  ${offenders.join('\n  ')}`);
});

/* ---- asset integrity ---- */

test('every local asset reference resolves to a file that exists', () => {
  const missing = [];
  for (const f of htmlFiles()) {
    const src = read(f);
    const dir = path.dirname(f);
    const refs = [...src.matchAll(/(?:src|href|srcset)="([^"]+)"/g)].map(m => m[1]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|#|data:|\/$)/.test(ref)) continue;
      const rel = ref.startsWith('/') ? ref.slice(1) : path.join(dir, ref).replace(/\\/g, '/');
      const clean = rel.split('?')[0].split('#')[0];
      if (!clean || clean.endsWith('/')) continue;
      if (!fs.existsSync(path.join(ROOT, clean))) missing.push(`${f} -> ${ref}`);
    }
  }
  assert.equal(missing.length, 0, `broken references:\n  ${missing.join('\n  ')}`);
});

/* The test above reads src/href/srcset out of HTML, so a path fetched at
   runtime by a script is invisible to it. dictionary/assets/js/app.js
   fetches 'data/search-index.json', the bare `data/` rule in .gitignore
   swallowed the directory, and the dictionary shipped with a search box
   that 404s into its own fallback message. Nothing failed. */
test('every relative path fetched by a script resolves to a file that exists', () => {
  const missing = [];
  for (const page of htmlFiles()) {
    const pageDir = path.dirname(page);
    const scripts = [...read(page).matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    for (const src of scripts) {
      if (/^https?:/.test(src)) continue;
      /* A <script src> is resolved against the page, like any other
         reference; the fetch inside it is resolved against the page too. */
      const jsPath = (src.startsWith('/') ? src.slice(1) : path.join(pageDir, src))
        .replace(/\\/g, '/').split('?')[0];
      if (!fs.existsSync(path.join(ROOT, jsPath))) continue;   // covered by the test above
      const js = read(jsPath);

      for (const m of js.matchAll(/fetch\(\s*['"]([^'"]+)['"]/g)) {
        const ref = m[1];
        if (/^(https?:|data:|blob:)/.test(ref)) continue;
        const rel = (ref.startsWith('/') ? ref.slice(1) : path.join(pageDir, ref))
          .replace(/\\/g, '/').split('?')[0].split('#')[0];
        if (!fs.existsSync(path.join(ROOT, rel))) {
          missing.push(`${page} loads ${jsPath}, which fetches '${ref}' -> ${rel} (no such file)`);
        }
      }

      /* new URL(x, import.meta.url) resolves against the *module*, not the
         document — which is exactly why app.js uses it: the hub and the term
         pages sit at different depths and a page-relative path can only be
         right for one of them. Resolve it the same way the browser will, or
         this guard silently stops covering the path it was written for. */
      for (const m of js.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) {
        const ref = m[1];
        if (/^(https?:|data:|blob:)/.test(ref)) continue;
        const rel = path.join(path.dirname(jsPath), ref)
          .replace(/\\/g, '/').split('?')[0].split('#')[0];
        if (!fs.existsSync(path.join(ROOT, rel))) {
          missing.push(`${page} loads ${jsPath}, which resolves '${ref}' against import.meta.url -> ${rel} (no such file)`);
        }
      }
    }
  }
  assert.equal(missing.length, 0,
    `a script fetches a path with no committed file behind it:\n  ${missing.join('\n  ')}`);
});

test('no <img> points at a master image', () => {
  const MASTERS = ['logo.jpeg', 'pratyush.jpeg', 'divyansh.jpeg', 'shashwat.jpeg'];
  const offenders = [];
  for (const f of htmlFiles()) {
    for (const [tag] of read(f).matchAll(/<(?:img|source)[^>]*>/g)) {
      for (const master of MASTERS) {
        if (tag.includes(master)) offenders.push(`${f}: ${tag.trim().slice(0, 90)}`);
      }
    }
  }
  assert.equal(offenders.length, 0,
    `masters are for the social card only — use a sized variant:\n  ${offenders.join('\n  ')}`);
});

test('every <img> declares width and height', () => {
  const offenders = [];
  for (const f of htmlFiles()) {
    for (const [tag] of read(f).matchAll(/<img[^>]*>/g)) {
      if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
        offenders.push(`${f}: ${tag.trim().slice(0, 90)}`);
      }
    }
  }
  assert.equal(offenders.length, 0,
    `missing intrinsic size (causes layout shift):\n  ${offenders.join('\n  ')}`);
});

/* ---- performance budget ---- */

test('no shipped image exceeds the per-image budget', () => {
  const dir = path.join(ROOT, 'assets', 'images');
  const MASTERS = new Set(['logo.jpeg', 'pratyush.jpeg', 'divyansh.jpeg', 'shashwat.jpeg', 'favicon-180.png']);
  const over = [];
  for (const f of fs.readdirSync(dir)) {
    if (MASTERS.has(f)) continue;   // not referenced by any <img>
    const kb = sizeKB(`assets/images/${f}`);
    if (kb > BUDGET.maxImageKB) over.push(`${f} ${kb.toFixed(1)}KB`);
  }
  assert.equal(over.length, 0, `over ${BUDGET.maxImageKB}KB:\n  ${over.join('\n  ')}`);
});

test('page scripts stay within the per-page JS budget', () => {
  /* Dev tooling lives in the root too but is never served, so it is not
     part of any page's weight. */
  const NOT_SHIPPED = new Set(['eslint.config.js']);
  const over = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.js') || NOT_SHIPPED.has(f)) continue;
    const kb = sizeKB(f);
    if (kb > BUDGET.maxPageScriptKB) over.push(`${f} ${kb.toFixed(1)}KB`);
  }
  assert.equal(over.length, 0, `over ${BUDGET.maxPageScriptKB}KB:\n  ${over.join('\n  ')}`);
});

/* The whole point of the dev tooling is that it stays out of the site.
   If node_modules ever ends up tracked, or a page starts referencing
   something from it, the zero-third-party property is gone. */
test('no page references anything from node_modules', () => {
  const offenders = [];
  for (const f of htmlFiles()) {
    if (/node_modules/.test(read(f))) offenders.push(f);
  }
  assert.equal(offenders.length, 0, `pages referencing node_modules:\n  ${offenders.join('\n  ')}`);
});

test('the homepage stays within its transfer budget', () => {
  /* What GitHub Pages actually puts on the wire: text gets gzipped,
     WOFF2 and AVIF are already compressed and are served as-is. */
  const text = ['index.html', 'styles.css', 'pages.css', 'fonts.css', 'script.js'];
  const binary = [
    'assets/images/logo-72.avif',
    'assets/fonts/outfit-latin.woff2',
    'assets/fonts/jetbrains-mono-latin.woff2',
  ];
  const total = text.reduce((n, f) => n + gzipKB(f), 0) + binary.reduce((n, f) => n + sizeKB(f), 0);
  const requests = text.length + binary.length;

  assert.ok(requests <= BUDGET.maxRequestsFirstLoad,
    `${requests} requests, budget is ${BUDGET.maxRequestsFirstLoad}`);
  assert.ok(total <= BUDGET.maxHomepageTransferKB,
    `homepage is ${total.toFixed(1)}KB transferred, budget is ${BUDGET.maxHomepageTransferKB}KB`);
});

/* ---- stylesheet integrity ---- */

/* A missing closing brace does not error anywhere. The parser recovers by
   consuming the next rule's declarations as though they belonged to the
   unterminated one, and the symptom is that some block of styling simply
   is not there — on the page it looks like the CSS was never written.

   This is not hypothetical: `.eda-bundle-note` shipped without its
   closing brace, which silently dropped the entire TOOLBENCH block that
   followed it, on every tool page, for as long as it was in. Nothing
   caught it because nothing errors. */
test('every stylesheet closes every block it opens', () => {
  /* Discovered rather than listed. A hardcoded list is the same drift
     this file exists to catch — the two article stylesheets were added
     after this test was written and would not have been covered. */
  const sheets = [];
  for (const dir of ['.', 'blogs', 'dictionary', 'dictionary/terms']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.css')) sheets.push(path.join(dir, f).replace(/\\/g, '/').replace(/^\.\//, ''));
    }
  }
  assert.ok(sheets.length >= 4, `only found ${sheets.length} stylesheets — the discovery is broken`);

  const unbalanced = [];
  for (const file of sheets) {
    /* Comments only. Braces inside a comment are prose; braces inside a
       quoted value are vanishingly rare in this codebase and stripping
       quotes naively breaks on the apostrophe in an English comment. */
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[{}]/g, ' '));
    let depth = 0;
    let line = 1;
    let firstExtraClose = 0;
    for (const ch of src) {
      if (ch === '\n') line += 1;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth < 0 && !firstExtraClose) firstExtraClose = line;
      }
    }
    if (depth !== 0) {
      unbalanced.push(`${file}: ${depth > 0 ? `${depth} block(s) never closed` : `extra } at line ${firstExtraClose}`}`);
    }
  }
  assert.deepEqual(unbalanced, [],
    `unbalanced braces silently drop whatever follows them:\n  ${unbalanced.join('\n  ')}`);
});

/* ---- source hygiene ---- */

test('no source file contains a NUL byte', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', 'assets'].includes(entry.name)) continue;
        walk(rel);
      } else if (/\.(js|css|html|md|txt|json|yml)$/.test(entry.name)) {
        if (fs.readFileSync(path.join(ROOT, rel)).includes(0x00)) offenders.push(rel);
      }
    }
  };
  walk('.');
  assert.equal(offenders.length, 0, `NUL bytes in:\n  ${offenders.join('\n  ')}`);
});

/* ---- dictionary search index integrity ---- */

/* The index is generated in 06pratyush/ai_dictionary_thl and committed
   here, so nothing in this repo regenerates it and CI cannot reach the
   source ([GAP-10]). A byte-for-byte sync like scripts/sync-spec.js is
   therefore impossible. What is checkable is the symptom that matters:
   the index and the term pages must describe the same 39 terms. Copy the
   pages across without the index and a term is unsearchable; update the
   index without the pages and search offers a dead link. Either way this
   fails, which is the drift signal the cross-repo copy cannot give. */
test('the dictionary search index and the term pages describe the same terms', () => {
  const indexPath = 'dictionary/data/search-index.json';
  const index = JSON.parse(read(indexPath));

  const onDisk = new Set(
    fs.readdirSync(path.join(ROOT, 'dictionary/terms'))
      .filter(f => f.endsWith('.html'))
      .map(f => f.replace(/\.html$/, '')));
  const indexed = new Set(index.entries.map(e => e.slug));

  const unsearchable = [...onDisk].filter(s => !indexed.has(s)).sort();
  const dangling = [...indexed].filter(s => !onDisk.has(s)).sort();

  assert.deepEqual(unsearchable, [],
    `term pages missing from ${indexPath} — search cannot find them. Regenerate the index in ai_dictionary_thl and copy it across.`);
  assert.deepEqual(dangling, [],
    `${indexPath} lists terms with no page under dictionary/terms/ — search would offer a dead link.`);
});

test('every search index entry declares a section that exists', () => {
  const index = JSON.parse(read('dictionary/data/search-index.json'));
  const sections = new Set(Object.keys(index.sections));
  const orphans = index.entries
    .filter(e => !sections.has(e.section))
    .map(e => `${e.slug} -> "${e.section}"`);
  assert.deepEqual(orphans, [],
    `entries reference a section absent from the index's own "sections" map:\n  ${orphans.join('\n  ')}`);
});

/* Search used to exist only on the dictionary hub: a reader on a term page
   had no way to look anything up without navigating back. app.js now runs
   on both, which is why its index path is resolved against the module
   rather than the document (see the fetch guard above). */
test('every dictionary term page ships the search UI and its controller', () => {
  const missing = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'dictionary/terms'))) {
    if (!f.endsWith('.html')) continue;
    const src = read(`dictionary/terms/${f}`);
    /* The ids app.js binds to. A page missing any one of them leaves the
       controller half-wired rather than visibly broken. */
    for (const id of ['search-form', 'search-input', 'search-clear', 'search-suggest',
      'results-block', 'results-title', 'results-count', 'results-grid',
      'results-more', 'results-suggestion']) {
      if (!src.includes(`id="${id}"`)) missing.push(`${f}: no #${id}`);
    }
    if (!/<script src="\.\.\/assets\/js\/app\.js" type="module"><\/script>/.test(src)) {
      missing.push(`${f}: does not load app.js`);
    }
    for (const scope of ['all', 'ai-mathematics', 'software-engineering']) {
      if (!src.includes(`data-scope="${scope}"`)) missing.push(`${f}: no "${scope}" scope button`);
    }
  }
  assert.deepEqual(missing, [],
    `term pages with incomplete search:\n  ${missing.slice(0, 12).join('\n  ')}`);
});


/* app.js runs at two depths — dictionary/ and dictionary/terms/ — so any
   path it builds relative to the *document* is wrong on one of them. Both
   the index fetch and the term links were written page-relative for the
   hub; on a term page `terms/x.html` resolved to
   dictionary/terms/terms/x.html and every search result 404'd. Caught in
   Chromium, not by this suite, because the hrefs are built at runtime.
   The string check below stands in for a browser: crude, but it fails the
   moment someone reintroduces the assumption. */
test('the dictionary controller builds no document-relative paths', () => {
  const src = read('dictionary/assets/js/app.js');
  const offenders = [];
  for (const m of src.matchAll(/\.href\s*=\s*[`'"]([^`'"]*)[`'"]/g)) {
    if (!/^(https?:|#|\/)/.test(m[1])) offenders.push(`.href = "${m[1]}"`);
  }
  for (const m of src.matchAll(/fetch\(\s*['"]([^'"]+)['"]/g)) {
    offenders.push(`fetch("${m[1]}")`);
  }
  assert.deepEqual(offenders, [],
    `app.js runs at two depths; resolve against import.meta.url instead:\n  ${offenders.join('\n  ')}`);
});
