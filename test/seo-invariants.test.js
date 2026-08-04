/* ============================================================
   seo-invariants.test.js — locks the discoverability surface.

   Search engines and LLM crawlers read files that nothing in the app
   references, so when a page is renamed these rot in total silence.
   That has already happened here twice: articles.html became
   blogs.html, image-converter.html became converter.html, and
   llms-full.txt went on telling AI crawlers that the Assistant required
   a local Ollama install for a full release after that stopped being
   true.

   Nothing catches that by looking at the site. These tests do.

   Everything reads files on disk. No browser, no network.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/load-pure');

const ORIGIN = 'https://thehallucinatedlab.space';

/* Google truncates titles past roughly 60 characters and descriptions
   past roughly 160. These are upper bounds, not targets. */
const TITLE_MAX = 70;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 165;

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function allPages() {
  const out = [];
  for (const dir of ['.', 'blogs']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html')) out.push(path.join(dir, f).replace(/\\/g, '/').replace(/^\.\//, ''));
    }
  }
  return out.sort();
}

const isNoindex = src => /name="robots"[^>]*noindex/i.test(src);
const meta = (src, re) => { const m = src.match(re); return m ? m[1] : null; };

const tag = {
  title: s => meta(s, /<title>([^<]*)<\/title>/),
  description: s => meta(s, /<meta name="description" content="([^"]*)"/),
  canonical: s => meta(s, /<link rel="canonical" href="([^"]*)"/),
  ogUrl: s => meta(s, /<meta property="og:url" content="([^"]*)"/),
  ogTitle: s => meta(s, /<meta property="og:title" content="([^"]*)"/),
  ogImage: s => meta(s, /<meta property="og:image" content="([^"]*)"/),
};

/* The URL a given file should claim as canonical. */
function expectedCanonical(file) {
  if (file === 'index.html') return ORIGIN;
  return `${ORIGIN}/${file}`;
}

const indexablePages = () => allPages().filter(f => !isNoindex(read(f)));
const stubPages = () => allPages().filter(f => isNoindex(read(f)));

/* ---- per-page tags ---- */

test('every indexable page has the tags a crawler needs', () => {
  const missing = [];
  for (const f of indexablePages()) {
    const src = read(f);
    for (const key of ['title', 'description', 'canonical', 'ogUrl', 'ogTitle', 'ogImage']) {
      if (!tag[key](src)) missing.push(`${f} -> ${key}`);
    }
  }
  assert.deepEqual(missing, [], `pages missing required tags:\n  ${missing.join('\n  ')}`);
});

test('each page claims the canonical URL that matches its own path', () => {
  const wrong = [];
  for (const f of indexablePages()) {
    const actual = tag.canonical(read(f));
    const expected = expectedCanonical(f);
    if (actual !== expected) wrong.push(`${f}: claims ${actual}, should be ${expected}`);
  }
  assert.deepEqual(wrong, [], `canonical does not match file path:\n  ${wrong.join('\n  ')}`);
});

test('og:url agrees with canonical', () => {
  const mismatched = [];
  for (const f of indexablePages()) {
    const src = read(f);
    if (tag.canonical(src) !== tag.ogUrl(src)) {
      mismatched.push(`${f}: canonical=${tag.canonical(src)} og:url=${tag.ogUrl(src)}`);
    }
  }
  assert.deepEqual(mismatched, [], `canonical and og:url disagree:\n  ${mismatched.join('\n  ')}`);
});

test('titles and descriptions are within the length search engines display', () => {
  const bad = [];
  for (const f of indexablePages()) {
    const src = read(f);
    const title = tag.title(src);
    const desc = tag.description(src);
    if (title.length > TITLE_MAX) bad.push(`${f}: title is ${title.length} chars (max ${TITLE_MAX})`);
    if (desc.length > DESCRIPTION_MAX) bad.push(`${f}: description is ${desc.length} chars (max ${DESCRIPTION_MAX})`);
    if (desc.length < DESCRIPTION_MIN) bad.push(`${f}: description is only ${desc.length} chars (min ${DESCRIPTION_MIN})`);
  }
  assert.deepEqual(bad, [], `outside displayable length:\n  ${bad.join('\n  ')}`);
});

/* Two pages sharing a title or description is the classic duplicate
   content signal - the crawler cannot tell which one to rank. */
test('no two pages share a title or a description', () => {
  const titles = new Map();
  const descs = new Map();
  const dupes = [];
  for (const f of indexablePages()) {
    const src = read(f);
    const t = tag.title(src);
    const d = tag.description(src);
    if (titles.has(t)) dupes.push(`title shared by ${titles.get(t)} and ${f}: "${t}"`);
    else titles.set(t, f);
    if (descs.has(d)) dupes.push(`description shared by ${descs.get(d)} and ${f}`);
    else descs.set(d, f);
  }
  assert.deepEqual(dupes, [], `duplicate metadata:\n  ${dupes.join('\n  ')}`);
});

test('og:image points at a file that exists', () => {
  const broken = [];
  for (const f of indexablePages()) {
    const url = tag.ogImage(read(f));
    if (!url.startsWith(ORIGIN)) { broken.push(`${f}: og:image is off-origin (${url})`); continue; }
    const rel = url.slice(ORIGIN.length).replace(/^\//, '');
    if (!fs.existsSync(path.join(ROOT, rel))) broken.push(`${f}: og:image 404s (${rel})`);
  }
  assert.deepEqual(broken, [], `broken social images:\n  ${broken.join('\n  ')}`);
});

/* ---- sitemap ---- */

function sitemapPaths() {
  const xml = read('sitemap.xml');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

test('the sitemap lists exactly the indexable pages — no more, no fewer', () => {
  const listed = new Set(sitemapPaths().map(u => (u === ORIGIN || u === `${ORIGIN}/` ? 'index.html' : u.slice(ORIGIN.length + 1))));
  const shipped = new Set(indexablePages());

  const missing = [...shipped].filter(p => !listed.has(p));
  const stale = [...listed].filter(p => !shipped.has(p));

  assert.deepEqual(missing, [], `shipped but absent from sitemap.xml:\n  ${missing.join('\n  ')}`);
  assert.deepEqual(stale, [], `in sitemap.xml but not shipped (or now noindex):\n  ${stale.join('\n  ')}`);
});

test('every sitemap entry resolves to a real file', () => {
  const broken = [];
  for (const url of sitemapPaths()) {
    const rel = url === ORIGIN || url === `${ORIGIN}/` ? 'index.html' : url.slice(ORIGIN.length + 1);
    if (!fs.existsSync(path.join(ROOT, rel))) broken.push(url);
  }
  assert.deepEqual(broken, [], `sitemap points at files that do not exist:\n  ${broken.join('\n  ')}`);
});

test('sitemap uses absolute canonical-origin URLs', () => {
  const wrong = sitemapPaths().filter(u => !u.startsWith(ORIGIN));
  assert.deepEqual(wrong, [], `non-canonical origin in sitemap:\n  ${wrong.join('\n  ')}`);
});

/* ---- redirect stubs ---- */

/* The renamed-page stubs exist so old links keep working. They must
   stay out of the index, or they compete with the page they point at. */
test('redirect stubs are noindex and stay out of the sitemap', () => {
  const listed = new Set(sitemapPaths().map(u => u.slice(ORIGIN.length + 1)));
  const leaked = stubPages().filter(f => listed.has(f));
  assert.deepEqual(leaked, [], `noindex pages listed in sitemap:\n  ${leaked.join('\n  ')}`);

  // Each stub should still point somewhere real.
  const dangling = [];
  for (const f of stubPages()) {
    const src = read(f);
    const target = meta(src, /<meta name="redirect-to" content="([^"]+)"/)
      || meta(src, /<meta http-equiv="refresh" content="0; url=([^"]+)"/);
    if (!target) continue;                       // 404.html has no redirect target
    if (!fs.existsSync(path.join(ROOT, target))) dangling.push(`${f} -> ${target}`);
  }
  assert.deepEqual(dangling, [], `redirect stubs pointing at missing pages:\n  ${dangling.join('\n  ')}`);
});

/* ---- robots.txt ---- */

test('robots.txt advertises the sitemap and does not block the site', () => {
  const src = read('robots.txt');
  assert.match(src, new RegExp(`Sitemap:\\s*${ORIGIN}/sitemap\\.xml`, 'i'),
    'robots.txt does not point at the sitemap');
  assert.doesNotMatch(src, /^\s*Disallow:\s*\/\s*$/m,
    'robots.txt contains a blanket Disallow: / — this delists the whole site');
});

/* ---- llms.txt / llms-full.txt ---- */

/* These are the AI-crawler equivalent of the sitemap. Nothing on the
   site links to them, so a rename leaves them describing a site that no
   longer exists. */
function linkedPaths(file) {
  const src = read(file);
  return [...src.matchAll(new RegExp(`${ORIGIN}/([A-Za-z0-9._/-]*)`, 'g'))]
    .map(m => m[1])
    .filter(p => p.endsWith('.html'));
}

for (const file of ['llms.txt', 'llms-full.txt']) {
  test(`${file} only links to pages that exist`, () => {
    const broken = [...new Set(linkedPaths(file))].filter(p => !fs.existsSync(path.join(ROOT, p)));
    assert.deepEqual(broken, [], `${file} links to missing pages:\n  ${broken.join('\n  ')}`);
  });

  test(`${file} covers every indexable page`, () => {
    const linked = new Set(linkedPaths(file));
    const uncovered = indexablePages().filter(p => p !== 'index.html' && !linked.has(p));
    assert.deepEqual(uncovered, [],
      `${file} does not mention:\n  ${uncovered.join('\n  ')}\n(a page absent here is invisible to LLM crawlers)`);
  });
}

/* ---- structured data ---- */

test('every JSON-LD block parses', () => {
  const broken = [];
  for (const f of allPages()) {
    const blocks = [...read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    blocks.forEach((b, i) => {
      try {
        const parsed = JSON.parse(b[1]);
        if (!parsed['@context']) broken.push(`${f} block ${i}: no @context`);
      } catch (err) {
        broken.push(`${f} block ${i}: ${err.message}`);
      }
    });
  }
  assert.deepEqual(broken, [], `malformed structured data:\n  ${broken.join('\n  ')}`);
});

test('structured data URLs use the canonical origin', () => {
  const wrong = [];
  for (const f of allPages()) {
    for (const b of read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      for (const m of b[1].matchAll(/"(https?:\/\/[^"]+)"/g)) {
        const url = m[1];
        if (url.startsWith(ORIGIN)) continue;
        if (/^https:\/\/(schema\.org|github\.com|www\.linkedin\.com|pypi\.org)/.test(url)) continue;
        wrong.push(`${f}: ${url}`);
      }
    }
  }
  assert.deepEqual(wrong, [], `unexpected origin in structured data:\n  ${wrong.join('\n  ')}`);
});
