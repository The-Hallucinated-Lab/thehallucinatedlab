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
  for (const dir of ['.', 'blogs']) {
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

test('no <img> points at a master image', () => {
  const MASTERS = ['logo.jpeg', 'pratyush.jpeg', 'divyansh.jpeg'];
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
  const MASTERS = new Set(['logo.jpeg', 'pratyush.jpeg', 'divyansh.jpeg', 'favicon-180.png']);
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
