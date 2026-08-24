#!/usr/bin/env node
/**
 * Sync the built dictionary output into this site's /dictionary/ copy.
 *
 * The dictionary is generated in its own repository, then adapted for this
 * site: local stylesheet and font paths instead of Google Fonts, a per-page
 * CSP meta, this site's navbar and footer, theme.js. That adaptation was done
 * by hand at integration time, which meant a rebuild upstream could not be
 * brought over without redoing it. This script makes it repeatable.
 *
 * The approach is deliberately surgical rather than a copy. Each page here is
 * split into site chrome and page content; only the parts the generator owns
 * are replaced:
 *
 *   - <title>
 *   - meta description, and the og/twitter descriptions derived from it
 *   - the JSON-LD graph
 *   - everything between <main> and </main>
 *
 * Everything else — the CSP, the asset paths, the navbar, browse.js, the
 * footer — is site-owned and left exactly as it is. That is what stops a sync
 * from silently reverting the letter filter or the CSP, both of which were
 * added here and do not exist upstream.
 *
 * Usage: node scripts/sync-dictionary.js <path-to-dictionary-repo> [--check]
 */

const fs = require('node:fs');
const path = require('node:path');

const DESCRIPTION_LIMIT = 155; // RULE-04: descriptions are 50-155 chars here.

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function truncate(description) {
  if (description.length <= DESCRIPTION_LIMIT) return description;
  const cut = description.slice(0, DESCRIPTION_LIMIT - 3);
  const stop = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
  return `${(stop > 60 ? cut.slice(0, stop) : cut).trimEnd()}...`;
}

function section(html, open, close) {
  const start = html.indexOf(open);
  if (start === -1) return null;
  const end = html.indexOf(close, start);
  if (end === -1) return null;
  return { start, end: end + close.length, value: html.slice(start, end + close.length) };
}

function attr(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : null;
}

/** Replace only the generator-owned parts of a site page. */
function merge(sitePage, sourcePage) {
  const title = section(sourcePage, '<title>', '</title>');
  const description = attr(sourcePage, /<meta name="description" content="([^"]*)"/);
  const jsonLd = section(sourcePage, '<script type="application/ld+json">', '</script>');
  const body = section(sourcePage, '<main', '</main>');

  if (!title || !description || !body) fail('source page is missing title, description or <main>');

  const short = truncate(description);
  let out = sitePage;

  out = out.replace(/<title>[\s\S]*?<\/title>/, title.value);
  out = out.replace(/(<meta name="description" content=")[^"]*(")/, `$1${short}$2`);
  out = out.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${short}$2`);
  out = out.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${short}$2`);
  out = out.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title.value.slice(7, -8)}$2`);
  out = out.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title.value.slice(7, -8)}$2`);

  const siteLd = section(out, '<script type="application/ld+json">', '</script>');
  if (jsonLd && siteLd) {
    out = out.slice(0, siteLd.start) + jsonLd.value + out.slice(siteLd.end);
  }

  const siteMain = section(out, '<main', '</main>');
  if (!siteMain) fail('site page has no <main> landmark');
  return out.slice(0, siteMain.start) + body.value + out.slice(siteMain.end);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const source = args.find((a) => !a.startsWith('--'));
  if (!source) fail('usage: node scripts/sync-dictionary.js <path-to-dictionary-repo> [--check]');

  const siteDir = path.join(__dirname, '..', 'dictionary');
  const pairs = [
    { src: path.join(source, 'index.html'), dest: path.join(siteDir, 'index.html') },
  ];

  const srcTerms = path.join(source, 'terms');
  if (!fs.existsSync(srcTerms)) fail(`no terms/ directory in ${source} — run its build first`);
  for (const name of fs.readdirSync(srcTerms).filter((n) => n.endsWith('.html'))) {
    pairs.push({ src: path.join(srcTerms, name), dest: path.join(siteDir, 'terms', name) });
  }

  // The stylesheet is NOT copied. The site patches it in several places —
  // the browse UI, the letter filter's [hidden] override, a gradient fix —
  // and none of that exists upstream, so a wholesale copy silently reverts
  // the letter filter. Only the delimited topic-page block is synced.
  const CSS_OPEN = '/* >>> topic-page-interface';
  const CSS_CLOSE = '/* <<< topic-page-interface */';

  let changed = 0;
  const stale = [];

  for (const { src, dest } of pairs) {
    if (!fs.existsSync(dest)) {
      stale.push(`${path.relative(siteDir, dest)} (new page — add it to the site by hand once, then re-run)`);
      continue;
    }
    const merged = merge(fs.readFileSync(dest, 'utf8'), fs.readFileSync(src, 'utf8'));
    if (merged !== fs.readFileSync(dest, 'utf8')) {
      changed += 1;
      stale.push(path.relative(siteDir, dest));
      if (!check) fs.writeFileSync(dest, merged);
    }
  }

  const cssFrom = path.join(source, 'assets', 'css', 'dictionary.css');
  const cssTo = path.join(siteDir, 'assets', 'css', 'dictionary.css');
  if (fs.existsSync(cssFrom) && fs.existsSync(cssTo)) {
    const upstream = fs.readFileSync(cssFrom, 'utf8');
    const open = upstream.indexOf(CSS_OPEN);
    const close = upstream.indexOf(CSS_CLOSE);
    if (open === -1 || close === -1) fail('upstream stylesheet has no topic-page-interface block');
    const block = upstream.slice(open, close + CSS_CLOSE.length);

    const current = fs.readFileSync(cssTo, 'utf8');
    const siteOpen = current.indexOf(CSS_OPEN);
    const siteClose = current.indexOf(CSS_CLOSE);
    const next =
      siteOpen === -1
        ? `${current.trimEnd()}\n\n${block}\n`
        : current.slice(0, siteOpen) + block + current.slice(siteClose + CSS_CLOSE.length);

    if (next !== current) {
      changed += 1;
      stale.push('assets/css/dictionary.css (topic-page block)');
      if (!check) fs.writeFileSync(cssTo, next);
    }
  }

  if (check) {
    if (changed > 0) {
      console.error(`dictionary copy is stale in ${changed} file(s):`);
      for (const name of stale.slice(0, 12)) console.error(`  ${name}`);
      if (stale.length > 12) console.error(`  ... and ${stale.length - 12} more`);
      process.exit(1);
    }
    console.log('dictionary copy is in sync');
    return;
  }

  console.log(`synced ${changed} file(s) from ${source}`);
}

main();
