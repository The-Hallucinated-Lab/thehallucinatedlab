/* ============================================================
   regressions.test.js — one test per failure this repo has actually
   shipped or nearly shipped. Nothing speculative lives here.

   Every check below exists because something went wrong, and the cost
   of finding it was a person noticing rather than a red build:

     - A palette token was used for body text at 2.77:1, well under the
       WCAG AA floor, in 38 places. It looked fine to the eye on a dark
       background, which is exactly why contrast has to be computed.
     - Two controls shipped with no accessible name: a file input that
       was visually hidden but still in the accessibility tree, and a
       textarea whose only label was a placeholder, which is not exposed
       as a name and disappears on first keystroke.
     - The install line said `pip install thehallucinatedlab` with no
       version floor. On Python 3.9 pip rejects the package during
       resolution and reports "No matching distribution found", which
       reads as "this package does not exist".
     - 63.5 MB of MNIST binaries were committed to a static-site repo,
       and had to be removed from history with a force-push that broke
       every clone.

   The three false positives that made the original audit useless are
   handled deliberately, and each is commented where it is handled:
   implicit <label> wrapping, `hidden` inputs, and text painted through
   background-clip with a transparent fill.

   Everything reads files on disk. No browser, no network.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadPure } = require('./helpers/load-pure');

/* ---- WCAG contrast maths ---- */

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function contrast(a, b) {
  const [hi, lo] = [luminance(a) + 0.05, luminance(b) + 0.05].sort((x, y) => y - x);
  return hi / lo;
}

/* Read one declaration block by its selector. Scanning the whole file
   would blend the dark tokens with the light overrides and silently test
   a palette that never renders. */
function tokens(selector = ':root') {
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, `styles.css has no "${selector} {" block`);
  const open = css.indexOf('{', start);
  const end = css.indexOf('}', open);
  const block = css.slice(open, end);
  const out = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = hexToRgb(m[2]);
  return out;
}

/* Both themes ship, so both are tested. The light theme cannot inherit
   the dark theme's gold: #c9a84c measures about 1.9:1 on white. */
const THEMES = [
  { name: 'dark', selector: ':root' },
  { name: 'light', selector: ':root[data-theme="light"]' },
];

function htmlFiles() {
  const out = [];
  for (const dir of ['.', 'blogs']) {
    const abs = path.join(ROOT, dir);
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.html')) out.push(path.join(dir, f).replace(/\\/g, '/'));
    }
  }
  return out;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* A meta-refresh stub has no content to structure. Holding it to the
   landmark and heading rules only manufactures failures. */
const isRedirectStub = (html) => /http-equiv=["']refresh["']/i.test(html);

/* ============================================================
   1.4.3 Contrast — the --text-muted regression
   ============================================================ */

for (const theme of THEMES) {
  test(`[${theme.name}] every text token clears WCAG AA on every surface`, () => {
    const t = tokens(theme.selector);
    const surfaces = ['bg-primary', 'bg-secondary', 'bg-card'];
    // Tokens used for prose or placeholders. Anything here must clear
    // 4.5:1 for normal text, not the 3:1 that only large text may use.
    const textTokens = ['text-primary', 'text-secondary', 'text-muted', 'gold-primary', 'gold-dark'];

    const failures = [];
    for (const fg of textTokens) {
      assert.ok(t[fg], `the ${theme.name} block no longer defines --${fg}`);
      for (const bg of surfaces) {
        assert.ok(t[bg], `the ${theme.name} block no longer defines --${bg}`);
        const ratio = contrast(t[fg], t[bg]);
        if (ratio < 4.5) failures.push(`--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(
      failures, [],
      `These ${theme.name}-theme pairs are below the 4.5:1 AA floor for body text.\n` +
      'If a token is only ever used for large text or icons, move it out of\n' +
      'textTokens above and say why — do not lower the threshold.',
    );
  });
}

test('the resting nav glyph clears 1.4.11 in both themes', () => {
  // Non-text UI, so the bar is 3:1. The resting opacity differs per theme
  // on purpose: reducing opacity in dark blends gold toward black and
  // contrast barely moves, but in light it blends toward white and
  // collapses — 0.6 measures 2.54:1 there.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const blend = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

  const darkOpacity = Number(
    (css.match(/\.nav-links\.is-icons a\.has-icon svg\s*\{[^}]*opacity:\s*([\d.]+)/) || [])[1],
  );
  assert.ok(darkOpacity > 0, 'could not find the resting glyph opacity');
  // A light-specific override is optional: whether one is needed depends
  // on the palette, and asserting that it exists would bake in one
  // particular design. What must hold is the ratio, whichever value
  // ends up applying.
  const lightOverride = Number(
    (css.match(/\[data-theme="light"\][^{]*\.has-icon svg\s*\{[^}]*opacity:\s*([\d.]+)/) || [])[1],
  );
  const lightOpacity = lightOverride > 0 ? lightOverride : darkOpacity;

  for (const [name, selector, opacity] of [
    ['dark', ':root', darkOpacity],
    ['light', ':root[data-theme="light"]', lightOpacity],
  ]) {
    const t = tokens(selector);
    const ratio = contrast(blend(t['gold-primary'], t['bg-primary'], opacity), t['bg-primary']);
    assert.ok(
      ratio >= 3,
      `${name}: resting glyph at opacity ${opacity} is ${ratio.toFixed(2)}:1, under the 3:1 ` +
      'that 1.4.11 requires. Raise the opacity or darken --gold-primary.',
    );
  }
});

test('the theme switch cannot flash the wrong theme', () => {
  // A deferred script runs after first paint, so the decision has to be
  // made by a blocking one. Inline is impossible here: every page sets
  // script-src 'self' with no unsafe-inline.
  const html = read('index.html');
  const tag = html.match(/<script[^>]*src="[^"]*theme\.js"[^>]*>/);
  assert.ok(tag, 'index.html does not load theme.js');
  assert.ok(
    !/\bdefer\b|\basync\b/.test(tag[0]),
    'theme.js must not be deferred or async — the theme would be chosen after paint.',
  );
  const headEnd = html.indexOf('</head>');
  assert.ok(
    html.indexOf(tag[0]) < headEnd,
    'theme.js must be in <head>, before anything renders.',
  );
});

test('every page with the navbar offers the theme toggle and a Sitemap link', () => {
  const missingToggle = [], missingSitemap = [];
  for (const file of htmlFiles()) {
    const html = read(file);
    if (isRedirectStub(html) || !/<nav class="navbar"/.test(html)) continue;
    if (!html.includes('id="theme-toggle"')) missingToggle.push(file);
    const nav = html.match(/<ul class="nav-links"[^>]*>[\s\S]*?<\/ul>/);
    if (!nav || !nav[0].includes('sitemap.html')) missingSitemap.push(file);
  }
  assert.deepEqual(missingToggle, [], 'These pages have a navbar but no theme toggle.');
  assert.deepEqual(
    missingSitemap, [],
    'Sitemap moved from the footer into the nav. A page that got the removal\n' +
    'but not the addition orphans the sitemap entirely — which is exactly what\n' +
    'happened once, on 22 pages at the same time.',
  );
});

test('the icon nav cannot be enhanced into the hamburger overlay', () => {
  /* Shipped bug: script.js added .is-icons at min-width 769px while the
     CSS turned .nav-links into the full-screen overlay all the way up to
     1024px. Between those two numbers the hamburger opened onto a column
     of bare glyphs — .is-icons clips every label to max-width:0, and the
     icon is meaningless once it is not sitting in the bar. It read as
     "half the menu items are missing" on any tablet, and on a phone in
     landscape.

     The two numbers are a single decision expressed in two files, so
     lock them together: enhance only from one pixel above wherever the
     overlay stops. */
  const js = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  const enhanceAt = Number(
    (js.match(/is-icons[\s\S]{0,400}?min-width:\s*(\d+)px/) ||
     js.match(/min-width:\s*(\d+)px[\s\S]{0,400}?is-icons/) || [])[1],
  );
  assert.ok(enhanceAt > 0, 'could not find the min-width that gates .is-icons in script.js');

  const overlayTo = Number(
    (css.match(/@media\s*\(max-width:\s*(\d+)px\)[\s\S]{0,2500}?\.nav-hamburger\s*\{[^}]*display:\s*flex/) || [])[1],
  );
  assert.ok(overlayTo > 0, 'could not find the max-width that shows the hamburger in styles.css');

  assert.equal(
    enhanceAt, overlayTo + 1,
    `script.js enhances the nav to icons at ${enhanceAt}px, but the hamburger overlay ` +
    `is still the nav up to ${overlayTo}px.\nEvery width in between opens the overlay ` +
    'with .is-icons applied, which clips the labels to nothing.\n' +
    `Set the JS gate to ${overlayTo + 1}px, or move the CSS breakpoint to match.`,
  );
});

/* ============================================================
   4.1.2 / 3.3.2 Accessible names — the chat-input regression
   ============================================================ */

test('every visible form control has an accessible name', () => {
  const problems = [];
  for (const file of htmlFiles()) {
    const html = read(file);
    if (isRedirectStub(html)) continue;

    for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      const tag = m[0];
      if (/type=["'](hidden|submit|button|reset)["']/i.test(tag)) continue;
      // `hidden` removes it from the accessibility tree entirely; a
      // visible control drives it. Not a naming failure.
      if (/\shidden(\s|>|\/)/i.test(tag)) continue;

      const id = (tag.match(/\bid=["']([^"']+)["']/) || [])[1];
      const hasAria = /aria-label=|aria-labelledby=/i.test(tag);
      const hasFor = id && new RegExp(`<label[^>]*\\bfor=["']${id}["']`, 'i').test(html);
      // An ancestor <label> is an implicit association and just as valid
      // as for=. Missing this is what made the first audit cry wolf.
      const before = html.slice(0, m.index);
      const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>') &&
                      html.indexOf('</label>', m.index) !== -1;

      if (!hasAria && !hasFor && !wrapped) {
        problems.push(`${file}: ${tag.slice(0, 72)}`);
      }
    }
  }
  assert.deepEqual(
    problems, [],
    'A placeholder is not an accessible name: it is not exposed as one and\n' +
    'it vanishes on first keystroke. Add aria-label, <label for>, or wrap\n' +
    'the control in a <label>. If the control is driven by a visible\n' +
    'button, mark it `hidden` so it leaves the accessibility tree.',
  );
});

test('every button and link has a name a screen reader can announce', () => {
  const problems = [];
  for (const file of htmlFiles()) {
    const html = read(file);
    if (isRedirectStub(html)) continue;

    for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
      const text = m[1].replace(/<[^>]*>/g, '').trim();
      if (!text && !/aria-label=|aria-labelledby=|title=/i.test(m[0])) {
        problems.push(`${file}: ${m[0].slice(0, 64).replace(/\s+/g, ' ')}`);
      }
    }
    for (const m of html.matchAll(/<a\b[^>]*href=[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = m[1].replace(/<[^>]*>/g, '').trim();
      if (!text && !/aria-label=|aria-labelledby=|title=/i.test(m[0])) {
        problems.push(`${file}: ${m[0].slice(0, 64).replace(/\s+/g, ' ')}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'An icon-only control needs aria-label.');
});

/* ============================================================
   The install line — the failure that started all of this
   ============================================================ */

test('every page showing an install command states the Python floor', () => {
  const pyproject = read('python/pyproject.toml');
  const floor = (pyproject.match(/requires-python\s*=\s*["']>=\s*(\d+\.\d+)["']/) || [])[1];
  assert.ok(floor, 'pyproject.toml no longer declares requires-python');

  const missing = [];
  for (const file of htmlFiles()) {
    const html = read(file);
    if (!/pip install "?thehallucinatedlab/.test(html)) continue;
    if (!html.includes(`Python ${floor}`)) missing.push(file);
  }
  assert.deepEqual(
    missing, [],
    `These pages show an install command without naming Python ${floor}+.\n` +
    'On an older interpreter pip filters the release out during resolution\n' +
    'and reports "No matching distribution found", which reads as "this\n' +
    'package does not exist". The version must be stated where people read\n' +
    'the command.',
  );
});

test('the documented Python floor matches what the package actually declares', () => {
  const pyproject = read('python/pyproject.toml');
  const floor = (pyproject.match(/requires-python\s*=\s*["']>=\s*(\d+\.\d+)["']/) || [])[1];
  const readme = read('python/README.md');
  assert.ok(
    readme.includes(`Python ${floor}`),
    `python/README.md is the PyPI long description and must name Python ${floor}.`,
  );
  // A classifier list that forgets a supported version is a silent lie
  // on the PyPI page.
  assert.ok(
    pyproject.includes(`Programming Language :: Python :: ${floor}`),
    `pyproject classifiers do not list ${floor}, the version it claims to require.`,
  );
});

/* ============================================================
   The MNIST regression — 63.5 MB in a static-site repo
   ============================================================ */

test('no dataset directories or binaries are committed', () => {
  const banned = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (rel === 'data') banned.push(`${rel}/ exists at the repo root`);
        else walk(abs);
      } else if (/\.idx[13]-ubyte$/.test(entry.name)) {
        banned.push(rel);
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(
    banned, [],
    'torchvision and friends default to ./data. Committing it once cost a\n' +
    'history rewrite and a force-push that broke every clone.',
  );
});

test('.gitignore still guards the paths a dataset would land in', () => {
  const ignore = read('.gitignore');
  for (const rule of ['data/', '*.idx3-ubyte', '*.idx1-ubyte']) {
    assert.ok(
      ignore.includes(rule),
      `.gitignore lost "${rule}". Without it the next training script re-adds the dataset.`,
    );
  }
});

test('no committed file is large enough to bloat every clone', () => {
  const LIMIT_KB = 1024;
  const heavy = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist'].includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        const kb = fs.statSync(abs).size / 1024;
        if (kb > LIMIT_KB) heavy.push(`${path.relative(ROOT, abs).replace(/\\/g, '/')} (${kb.toFixed(0)} KB)`);
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(
    heavy, [],
    `Nothing tracked here should exceed ${LIMIT_KB} KB — the largest legitimate\n` +
    'file is under 100 KB. Git never forgets a blob, so this is cheaper to\n' +
    'catch now than to rewrite out of history later.',
  );
});

/* ============================================================
   Accessibility features that are invisible until the one user
   who needs them arrives
   ============================================================ */

/* ============================================================
   The thl.lab alias — it is only an alias while it stays pinned
   ============================================================ */

test('the alias pins the exact version of the package it aliases', () => {
  const real = read('python/pyproject.toml');
  const alias = read('alias/pyproject.toml');

  const realVersion = (real.match(/^version\s*=\s*["']([^"']+)["']/m) || [])[1];
  const aliasVersion = (alias.match(/^version\s*=\s*["']([^"']+)["']/m) || [])[1];
  assert.ok(realVersion, 'python/pyproject.toml has no version');
  assert.equal(
    aliasVersion, realVersion,
    'alias/pyproject.toml version must match python/pyproject.toml. An alias that\n' +
    'can resolve to a different version than the package it aliases is not an\n' +
    'alias, it is a second package that will surprise somebody.',
  );

  const pin = (alias.match(/dependencies\s*=\s*\[\s*["']thehallucinatedlab==([^"']+)["']/) || [])[1];
  assert.equal(pin, realVersion, `the alias pins ==${pin}, but the package is ${realVersion}`);
});

test('the alias mirrors every extra, so no install command dead-ends', () => {
  const extrasOf = (toml) => {
    const block = toml.split('[project.optional-dependencies]')[1];
    if (!block) return [];
    return [...block.split(/\n\[/)[0].matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*\[/gm)].map(m => m[1]);
  };
  // `dev` is the maintainers' toolchain, not something an installer asks for.
  const real = extrasOf(read('python/pyproject.toml')).filter(e => e !== 'dev').sort();
  const alias = extrasOf(read('alias/pyproject.toml')).sort();

  assert.deepEqual(
    alias, real,
    'Every extra on the real package must exist on the alias, or\n' +
    '`pip install "thl.lab[extract]"` fails with "does not provide the extra"\n' +
    'and the shorter name becomes a trap instead of a shortcut.',
  );
});

test('the alias ships no code, so there is one import path', () => {
  const alias = read('alias/pyproject.toml');
  assert.match(
    alias, /bypass-selection\s*=\s*true/,
    'The alias wheel must stay metadata-only. Shipping a module would give the\n' +
    'library two import names, and tracebacks would start disagreeing with the docs.',
  );
  const files = fs.readdirSync(path.join(ROOT, 'alias'));
  const code = files.filter(f => /\.(py|js)$/.test(f));
  assert.deepEqual(code, [], `alias/ should contain no source files, found: ${code.join(', ')}`);
});

test('the alias requires the same Python as the package', () => {
  const pick = f => (read(f).match(/requires-python\s*=\s*["']([^"']+)["']/) || [])[1];
  assert.equal(pick('alias/pyproject.toml'), pick('python/pyproject.toml'));
});

test('the stylesheet still handles forced colors and reduced motion', () => {
  const css = read('styles.css');
  assert.match(
    css, /@media\s*\(forced-colors:\s*active\)/,
    'forced-colors overrides `color` but NOT `fill` on an SVG. Without this\n' +
    'block the gold nav glyphs stay gold on a white Canvas in Windows High\n' +
    'Contrast, which is under 2:1.',
  );
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(
    css, /forced-colors[\s\S]{0,900}fill:\s*CanvasText/,
    'The forced-colors block must hand SVG fill back to a system colour.',
  );
});

test('hover-only affordances are suppressed where there is no hover', () => {
  const css = read('styles.css');
  // The tooltip is absolutely positioned but still contributes scrollable
  // overflow, and nowrap made it far wider than its 50px control — enough
  // to push a 320px viewport to 330px and break 1.4.10 Reflow.
  assert.match(
    css, /@media\s*\(hover:\s*none\)[^{]*\{[\s\S]{0,400}content:\s*none/,
    'A tooltip that cannot be triggered on touch still takes up layout and\n' +
    'can break Reflow. Keep it suppressed under (hover: none).',
  );
});

/* ============================================================
   Tool names the code looks up must exist in the manifest.

   The convert tool shipped broken: every conversion failed with
   "converter is not in the tool spec." 23b1e86 renamed the tool from
   "converter" to "convert" across the manifest, the page, the CLI and
   the Python package, but the rename was lost from toolkit.js when the
   rag-toolchain branch merged, and nothing caught it. runImageConvert
   kept asking the manifest for a tool called "converter", which the
   manifest no longer had, so it rejected before it ever reached a
   canvas.

   Nothing failed loudly enough to notice: the page still loaded, the
   drop zone still took a file, the argument table still rendered, and
   the whole 202-test suite still passed - because everything it covers
   is reachable without ever naming a tool. The one string that names a
   tool sits outside the @pure block, so no unit test could see it.

   Hence a source-level check. Every tool name the browser code looks
   up, dispatches on, or mounts a widget for is read out of the source
   and matched against the spec. A rename that misses a file now fails
   the build rather than the tool.
   ============================================================ */

const manifestTools = new Set(
  JSON.parse(read('spec/manifest.json')).tools.map(t => t.name),
);

const runtime = loadPure('toolkit.js', [
  'canRun', 'normalizeToolName', 'BROWSER_RUNNERS', 'LEGACY_TOOL_NAMES', 'findTool',
]);

/* Root-level .js only: the site ships plain <script> files, and test/
   and scripts/ are dev tooling that never reaches a browser. */
const siteScripts = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(e => e.isFile() && e.name.endsWith('.js') && e.name !== 'eslint.config.js')
  .map(e => e.name);

test('every tool name the code looks up exists in the manifest', () => {
  const misses = [];
  for (const file of siteScripts) {
    const src = read(file);
    /* findTool(manifest, 'convert') — the lookup that broke. */
    for (const m of src.matchAll(/findTool\(\s*[\w$.]+\s*,\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!manifestTools.has(m[1])) misses.push(`${file}: findTool(…, '${m[1]}')`);
    }
  }
  assert.ok(siteScripts.includes('toolkit.js'), 'toolkit.js was not scanned');
  assert.deepEqual(misses, [], 'These names are not in spec/manifest.json:\n' + misses.join('\n'));
});

test('every tool the runtime can execute exists in the manifest', () => {
  /* The runner table is what run() dispatches on. A name in it that the
     manifest does not carry is a tool nothing can ever invoke — which is
     precisely the shape of the convert bug. */
  assert.ok(runtime.BROWSER_RUNNERS.length, 'nothing can run in the page at all — did the table get renamed?');
  for (const name of runtime.BROWSER_RUNNERS) {
    assert.ok(manifestTools.has(name),
      `the runtime can run "${name}", which is not in spec/manifest.json`);
  }
  assert.equal(runtime.canRun('convert'), true, 'convert must be runnable in the page');
});

test('every legacy tool name resolves to a tool that still exists', () => {
  /* An alias pointing at a name that was itself renamed is worse than no
     alias: it reports "unknown tool" for a name the code claims to
     support. */
  for (const [old, canonical] of Object.entries(runtime.LEGACY_TOOL_NAMES)) {
    assert.ok(manifestTools.has(canonical),
      `legacy name "${old}" maps to "${canonical}", which is not in the manifest`);
    assert.equal(runtime.normalizeToolName(old), canonical);
    assert.ok(!manifestTools.has(old),
      `"${old}" is listed as legacy but is also a live tool name — one of the two is wrong`);
  }
});

test('a canonical name is never rewritten by the alias table', () => {
  for (const name of manifestTools) {
    assert.equal(runtime.normalizeToolName(name), name,
      `${name} is a real tool but the alias table rewrites it`);
  }
});

test('every tool widget mounted in the markup names a real tool', () => {
  const misses = [];
  for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
    const html = read(file);
    for (const m of html.matchAll(/data-tool(?:bench)?=["']([^"']+)["']/g)) {
      if (!manifestTools.has(m[1])) misses.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(misses, [], 'These widgets name a tool the manifest does not have:\n' + misses.join('\n'));
});
