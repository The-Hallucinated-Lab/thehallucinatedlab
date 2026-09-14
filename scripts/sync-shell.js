#!/usr/bin/env node
'use strict';

/* sync-shell.js — the one editor of the site chrome.
 *
 * Every page carries the same header (navbar), footer, favicon links and
 * font preloads, pasted by hand into ~70 files. Hand-pasting is how the
 * dictionary ended up with a 1024px JPEG as its favicon and a 1200×630
 * og:image size for a square file. This script renders those blocks from
 * one template per block and writes them into every page that has a navbar,
 * adjusting only the relative prefix for the page's depth.
 *
 * What is page-specific and therefore copied verbatim, never regenerated:
 *   - the <ul class="nav-links"> — its hrefs, the active item and the
 *     data-status="dev" entries are the page's own business
 *   - everything outside the header / footer / favicon / preload blocks
 *
 * scripts/sync-dictionary.js rewrites <title>, the description metas, the
 * first JSON-LD block and <main>…</main> of dictionary pages. Those byte
 * ranges never overlap with the ones here, so the two scripts commute.
 *
 *   node scripts/sync-shell.js            rewrite stale pages
 *   node scripts/sync-shell.js --check    exit 1 and list stale pages
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['.', 'blogs', 'dictionary', 'dictionary/terms'];

/* ---------------------------------------------------------------- pure */

/* Relative prefix from a page to the repo root. 404.html is served at
   whatever path was not found, so it must use root-absolute URLs. */
function prefixFor(rel) {
  if (rel === '404.html') return '/';
  return '../'.repeat(rel.split('/').length - 1);
}

/* The logo link: "/" from the root, "../" from a subdirectory. */
function homeHref(prefix) {
  return prefix === '' ? '/' : prefix;
}

/* Locate the shell header: the bare <header> that wraps the navbar. It must
   be the first <header of any kind (term pages have <header class="term-hero">
   inside <main>) and must close before <main>. Returns null when the page has
   no navbar, so redirect stubs are skipped. */
function sliceHeader(html) {
  const start = html.indexOf('<header>');
  if (start === -1 || !/<nav class="navbar"/.test(html)) return null;
  if (html.indexOf('<header') !== start) throw new Error('shell <header> is not the first <header');
  const end = html.indexOf('</header>', start);
  if (end === -1) throw new Error('shell <header> never closes');
  const mainAt = html.search(/<main[\s>]/);
  if (mainAt !== -1 && mainAt < end) throw new Error('shell <header> closes after <main>');
  const block = html.slice(start, end + '</header>'.length);
  const uls = block.match(/<ul class="nav-links"[^>]*>[\s\S]*?<\/ul>/g) || [];
  if (uls.length !== 1) throw new Error(`expected one <ul class="nav-links">, found ${uls.length}`);
  return { start, end: end + '</header>'.length, ul: uls[0] };
}

const SUN = 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z';
const MOON = 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z';

function renderHeader(prefix, ul) {
  const p = prefix;
  return `<header>
    <nav class="navbar" id="navbar" role="navigation" aria-label="Main navigation">
      <a href="${homeHref(p)}" class="nav-logo">
        <picture>
          <source srcset="${p}assets/images/logo-72.avif" type="image/avif">
          <source srcset="${p}assets/images/logo-72.webp" type="image/webp">
          <img src="${p}assets/images/logo-72.jpg" alt="The Hallucinated Lab logo" width="36" height="36" fetchpriority="high" decoding="async">
        </picture>
        <span>THE HALLUCINATED LAB</span>
      </a>
      ${ul}
      <button class="theme-toggle" id="theme-toggle" aria-label="Switch to light theme" title="Switch to light theme">
        <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="${SUN}"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MOON}"/></svg>
      </button>
      <button class="nav-hamburger" id="nav-hamburger" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="nav-links">
        <span></span><span></span><span></span>
      </button>
    </nav>
  </header>`;
}

/* Apply every template to one page. Pure: (html, rel) -> html. Throws on a
   page whose anchors do not match, rather than guessing. */
function render(html, rel) {
  const header = sliceHeader(html);
  if (!header) return html;
  const footers = html.match(/<footer class="footer">[\s\S]*?<\/footer>/g) || [];
  if (footers.length !== 1) throw new Error(`expected one <footer class="footer">, found ${footers.length}`);
  const prefix = prefixFor(rel);
  return html.slice(0, header.start) + renderHeader(prefix, header.ul) + html.slice(header.end);
}

/* ---------------------------------------------------------------- io */

function pageFiles() {
  const out = [];
  for (const dir of DIRS) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html')) out.push(path.posix.join(dir === '.' ? '' : dir, f));
    }
  }
  return out.sort();
}

function main(argv) {
  const check = argv.includes('--check');
  const stale = [];
  let seen = 0;
  for (const rel of pageFiles()) {
    const abs = path.join(ROOT, rel);
    const before = fs.readFileSync(abs, 'utf8');
    let after;
    try {
      after = render(before, rel);
    } catch (err) {
      console.error(`${rel}: ${err.message}`);
      process.exitCode = 2;
      continue;
    }
    if (after === before) { if (sliceHeader(before)) seen++; continue; }
    seen++;
    stale.push(rel);
    if (!check) fs.writeFileSync(abs, after, 'utf8');
  }
  if (check) {
    if (stale.length) {
      console.error(`sync-shell: ${stale.length} stale page(s) — run \`node scripts/sync-shell.js\`:\n  ${stale.join('\n  ')}`);
      process.exitCode = 1;
    } else {
      console.log(`sync-shell: ${seen} pages in sync`);
    }
  } else {
    console.log(`sync-shell: rewrote ${stale.length} of ${seen} pages`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { prefixFor, homeHref, sliceHeader, renderHeader, render };
