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

/* The lotus is inline on every page so its petals can be styled and animated
   by the page's CSS (a <use> of an external file cannot be). The geometry is
   read from logo.svg at run time, so the nav, the footer and the rasters
   scripts/render-logo.py produces all come from one file. */
function lotusPaths() {
  const svg = fs.readFileSync(path.join(ROOT, 'assets', 'images', 'logo.svg'), 'utf8');
  const paths = svg.match(/<path class="petal[^"]*" d="[^"]+"\/>/g) || [];
  if (paths.length !== 4) throw new Error(`logo.svg should have four petals, found ${paths.length}`);
  return paths;
}

function renderLotus(className, indent) {
  const inner = lotusPaths().map((p) => `${indent}  ${p}`).join('\n');
  return `<svg class="${className}" viewBox="0 0 256 256" aria-hidden="true" focusable="false">\n${inner}\n${indent}</svg>`;
}

function renderHeader(prefix, ul) {
  const p = prefix;
  return `<header>
    <nav class="navbar" id="navbar" role="navigation" aria-label="Main navigation">
      <div class="nav-pill">
        <a href="${homeHref(p)}" class="nav-logo" aria-label="The Hallucinated Lab — home">
          ${renderLotus('lotus', '          ')}
          <span class="nav-wordmark">THE HALLUCINATED LAB</span>
        </a>
        ${ul}
        <button class="theme-toggle" id="theme-toggle" aria-label="Switch to light theme" title="Switch to light theme">
          <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="${SUN}"/></svg>
          <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MOON}"/></svg>
        </button>
        <button class="nav-hamburger" id="nav-hamburger" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="nav-links">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
  </header>`;
}

/* The footer is the same on every page. Links use the page's prefix; the
   About and Contact anchors live on the homepage. The wording is the
   identity's, not marketing: what the lab is, where to go, who owns it. */
function renderFooter(prefix) {
  const p = prefix;
  const home = homeHref(p);
  return `<footer class="footer">
    <div class="footer-inner">
      ${renderLotus('lotus lotus-mono', '      ')}
      <p class="footer-wordmark">THE HALLUCINATED LAB</p>
      <p class="footer-tag">AI. ML. SOFTWARE. ENGINEERED WITH PURPOSE.</p>
      <ul class="footer-links">
        <li><a href="${p}tools.html">Tools</a></li>
        <li><a href="${p}media.html">Media</a></li>
        <li><a href="${home}#about">About</a></li>
        <li><a href="${home}#contact">Contact</a></li>
        <li><a href="${p}sitemap.html">Sitemap</a></li>
      </ul>
      <p class="footer-text">PRIVATE BY DESIGN · © 2026 <a href="https://thehallucinatedlab.space">The Hallucinated Lab</a></p>
    </div>
  </footer>`;
}

/* SVG first so browsers that understand it take the vector; the PNGs are
   the fallback and the Apple touch icon. */
function renderIcons(prefix, indent) {
  const p = prefix;
  return [
    `<link rel="icon" type="image/svg+xml" href="${p}assets/images/logo.svg">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${p}assets/images/favicon-32.png">`,
    `<link rel="apple-touch-icon" href="${p}assets/images/favicon-180.png">`,
  ].map((l) => `${indent}${l}\n`).join('');
}

/* Replace every favicon link with the canonical triple at the position of
   the first one. A page with no favicon link at all is left alone rather
   than guessed at. */
function applyIcons(html, prefix) {
  const re = /([ \t]*)<link rel="(?:icon|apple-touch-icon)"[^>]*>\n/g;
  const first = re.exec(html);
  if (!first) return html;
  const indent = first[1];
  const stripped = html.replace(re, '');
  const at = first.index;
  return stripped.slice(0, at) + renderIcons(prefix, indent) + stripped.slice(at);
}

/* logo.jpeg is 1024x1024; the dictionary pages claimed 1200x630 for it. */
function applyOgImageSize(html) {
  if (!/property="og:image" content="[^"]*\/logo\.jpeg"/.test(html)) return html;
  return html
    .replace(/(<meta property="og:image:width" content=")\d+(")/, '$11024$2')
    .replace(/(<meta property="og:image:height" content=")\d+(")/, '$11024$2');
}

/* The fonts on the first-load path. Root-absolute on every page (fonts.css
   itself resolves its src the same way), so the list never varies with
   depth and test/site-invariants.test.js can name the same files. */
const PRELOADS = [
  '/assets/fonts/manrope-latin.woff2',
  '/assets/fonts/ibm-plex-mono-latin-400.woff2',
  '/assets/fonts/ibm-plex-mono-latin-500.woff2',
];

function renderPreloads(indent) {
  return PRELOADS
    .map((href) => `${indent}<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>\n`)
    .join('');
}

/* Drop every existing font preload and re-insert the canonical set just
   before the fonts.css stylesheet link, matching that line's indentation. */
function applyPreloads(html, prefix) {
  const stripped = html.replace(/[ \t]*<link rel="preload" href="[^"]*\.woff2"[^>]*>\n/g, '');
  const escaped = prefix.replace(/[./]/g, '\\$&');
  const anchor = new RegExp(`([ \\t]*)<link rel="stylesheet" href="${escaped}fonts\\.css">`, 'g');
  const hits = stripped.match(anchor) || [];
  if (hits.length !== 1) throw new Error(`expected one fonts.css link, found ${hits.length}`);
  return stripped.replace(anchor, (m, indent) => renderPreloads(indent) + m);
}

function render(html, rel) {
  const header = sliceHeader(html);
  if (!header) return html;
  const footers = html.match(/<footer class="footer">[\s\S]*?<\/footer>/g) || [];
  if (footers.length !== 1) throw new Error(`expected one <footer class="footer">, found ${footers.length}`);
  const prefix = prefixFor(rel);
  let out = html.slice(0, header.start) + renderHeader(prefix, header.ul) + html.slice(header.end);
  out = out.replace(footers[0], renderFooter(prefix));
  out = applyPreloads(out, prefix);
  out = applyIcons(out, prefix);
  return applyOgImageSize(out);
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

module.exports = {
  prefixFor, homeHref, sliceHeader, renderHeader, renderFooter, renderPreloads, applyPreloads,
  renderIcons, applyIcons, applyOgImageSize, render, PRELOADS,
};
