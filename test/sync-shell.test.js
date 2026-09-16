/* ============================================================
   sync-shell.test.js — scripts/sync-shell.js is the only thing that
   writes the header, footer, favicon and preload markup on ~70 pages.
   A wrong anchor there is a wrong edit on every page at once, so the
   slicing and the prefix maths are pinned here against small fixtures.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { prefixFor, homeHref, sliceHeader, renderHeader, render, applyPreloads, PRELOADS } = require('../scripts/sync-shell.js');

const UL = `<ul class="nav-links" id="nav-links">
        <li><a href="/" class="active">Home</a></li>
        <li><a href="/sitemap.html">Sitemap</a></li>
        <li data-status="dev"><a href="slm.html">SLM</a></li>
      </ul>`;

const HEADER = `<header>
    <nav class="navbar" id="navbar" role="navigation" aria-label="Main navigation">
      <a href="/" class="nav-logo"><span>THE HALLUCINATED LAB</span></a>
      ${UL}
      <button class="theme-toggle" id="theme-toggle" aria-label="Switch to light theme">x</button>
    </nav>
  </header>`;

const MAIN = '<main id="main-content"><header class="term-hero"><h1>T</h1></header><p>body</p></main>';
const FOOTER = '<footer class="footer"><p class="footer-text">© 2026</p></footer>';

/* Assemble a page from named parts so a test can swap exactly one of them. */
const FONTS_LINK = '  <link rel="stylesheet" href="fonts.css">\n';
const BLOG_FONTS_LINK = '  <link rel="stylesheet" href="../fonts.css">\n';

function page({ header = HEADER, main = MAIN, footer = FOOTER, before = '', fontsLink = FONTS_LINK } = {}) {
  return `<!doctype html><html><head><title>t</title>
${fontsLink}</head><body>
<a class="skip-link" href="#main">Skip</a>
${before}  ${header}
  ${main}
  ${footer}
</body></html>
`;
}

/* ---- prefixFor / homeHref ---- */

test('prefixFor gives the root an empty prefix', () => {
  assert.equal(prefixFor('index.html'), '');
  assert.equal(prefixFor('tools.html'), '');
});

test('prefixFor climbs one directory per path segment', () => {
  assert.equal(prefixFor('blogs/sample-blog.html'), '../');
  assert.equal(prefixFor('dictionary/terms/acid.html'), '../../');
});

test('prefixFor makes 404.html root-absolute, because it is served at any depth', () => {
  assert.equal(prefixFor('404.html'), '/');
});

test('homeHref turns the empty prefix into "/" and leaves the rest alone', () => {
  assert.equal(homeHref(''), '/');
  assert.equal(homeHref('../'), '../');
  assert.equal(homeHref('../../'), '../../');
  assert.equal(homeHref('/'), '/');
});

/* ---- sliceHeader ---- */

test('sliceHeader returns the exact block bounds and the verbatim <ul>', () => {
  const html = page();
  const h = sliceHeader(html);
  assert.ok(h, 'expected a header');
  assert.equal(h.start, html.indexOf('<header>'));
  assert.equal(html.slice(h.start, h.end), HEADER);
  assert.equal(h.ul, UL);
});

test('sliceHeader returns null for a page with no navbar (a redirect stub)', () => {
  assert.equal(sliceHeader('<!doctype html><html><body><header><p>x</p></header></body></html>'), null);
  assert.equal(sliceHeader('<!doctype html><html><body><main><p>x</p></main></body></html>'), null);
});

test('sliceHeader refuses a page whose first <header is not the shell header', () => {
  const html = page({ before: '<header class="term-hero"><h1>T</h1></header>\n' });
  assert.throws(() => sliceHeader(html), /first <header/);
});

test('sliceHeader refuses a shell header that never closes', () => {
  const html = page({ header: HEADER.replace('</header>', ''), main: '<p>body</p>' });
  assert.throws(() => sliceHeader(html), /never closes/);
});

test('sliceHeader refuses a <main> that opens before the shell header closes', () => {
  const html = page({ header: HEADER.replace('</nav>', '</nav><main id="m">'), main: '</main>' });
  assert.throws(() => sliceHeader(html), /<main>/);
});

test('sliceHeader refuses a header with zero or two nav lists', () => {
  const two = page({ header: HEADER.replace('</nav>', `${UL}</nav>`) });
  assert.throws(() => sliceHeader(two), /found 2/);
  const none = page({ header: HEADER.replace(UL, '') });
  assert.throws(() => sliceHeader(none), /found 0/);
});

/* ---- renderHeader ---- */

test('renderHeader embeds the <ul> byte for byte', () => {
  const out = renderHeader('', UL);
  assert.ok(out.startsWith('<header>'));
  assert.ok(out.endsWith('</header>'));
  assert.ok(out.includes(UL));
});

test('renderHeader prefixes the logo assets and links home for the depth', () => {
  const blog = renderHeader('../', UL);
  assert.ok(blog.includes('href="../" class="nav-logo"'));
  assert.ok(blog.includes('../assets/images/logo-72.jpg'));
  const root = renderHeader('', UL);
  assert.ok(root.includes('href="/" class="nav-logo"'));
  assert.ok(root.includes('src="assets/images/logo-72.jpg'));
  const notFound = renderHeader('/', UL);
  assert.ok(notFound.includes('src="/assets/images/logo-72.jpg'));
});

test('renderHeader keeps the controls the tests and script.js key off', () => {
  const out = renderHeader('', UL);
  assert.ok(out.includes('<nav class="navbar" id="navbar"'));
  assert.ok(out.includes('id="theme-toggle"'));
  assert.ok(out.includes('id="nav-hamburger"'));
  assert.ok(out.includes('aria-controls="nav-links"'));
});

test('renderHeader is deterministic', () => {
  assert.equal(renderHeader('../../', UL), renderHeader('../../', UL));
});

/* ---- render ---- */

test('render leaves a page without a navbar untouched', () => {
  const stub = '<!doctype html><html><body><main><p>moved</p></main></body></html>';
  assert.equal(render(stub, 'articles.html'), stub);
});

test('render refuses a page with zero or two site footers', () => {
  assert.throws(() => render(page({ footer: '' }), 'x.html'), /found 0/);
  assert.throws(() => render(page({ footer: FOOTER + FOOTER }), 'x.html'), /found 2/);
});

test('render ignores a blog-footer when counting site footers', () => {
  const html = page({ main: `${MAIN}<footer class="blog-footer"><p>tags</p></footer>`, fontsLink: BLOG_FONTS_LINK });
  assert.doesNotThrow(() => render(html, 'blogs/x.html'));
});

test('render touches only the header block and the preload lines', () => {
  const html = page({ fontsLink: BLOG_FONTS_LINK });
  const out = render(html, 'blogs/x.html');
  const h = sliceHeader(html);
  const outHead = sliceHeader(out);
  // Before the header: identical once the inserted preload lines are removed.
  const beforeOut = out.slice(0, outHead.start).replace(/[ \t]*<link rel="preload"[^>]*>\n/g, '');
  assert.equal(beforeOut, html.slice(0, h.start));
  // After the header: byte-identical.
  assert.equal(out.slice(outHead.end), html.slice(h.end));
  assert.ok(out.includes('href="../" class="nav-logo"'));
});

test('render is a fixed point', () => {
  const html = page({ fontsLink: '<link rel="stylesheet" href="../../fonts.css">\n' });
  const once = render(html, 'dictionary/terms/acid.html');
  assert.equal(render(once, 'dictionary/terms/acid.html'), once);
});

test('render preserves the dev-only <li> bytes that dev-mode.test.js parses', () => {
  const out = render(page(), 'index.html');
  assert.ok(out.includes('<li data-status="dev"><a href="slm.html">SLM</a></li>'));
});

/* ---- preloads ---- */

test('applyPreloads inserts the canonical set before fonts.css, root-absolute at every depth', () => {
  const out = applyPreloads(page(), '');
  const at = out.indexOf('<link rel="stylesheet" href="fonts.css">');
  const block = out.slice(0, at);
  for (const href of PRELOADS) assert.ok(block.includes(`href="${href}"`), href);
  assert.equal((out.match(/rel="preload"/g) || []).length, PRELOADS.length);
  const deep = applyPreloads(page({ fontsLink: '<link rel="stylesheet" href="../../fonts.css">\n' }), '../../');
  assert.ok(deep.includes('href="/assets/fonts/manrope-latin.woff2"'));
});

test('applyPreloads replaces stale preloads instead of stacking them', () => {
  const stale = page({ fontsLink: `  <link rel="preload" href="/assets/fonts/outfit-latin.woff2" as="font" type="font/woff2" crossorigin>\n${FONTS_LINK}` });
  const out = applyPreloads(stale, '');
  assert.ok(!out.includes('outfit-latin'));
  assert.equal((out.match(/rel="preload"/g) || []).length, PRELOADS.length);
  assert.equal(applyPreloads(out, ''), out);
});

test('applyPreloads refuses a page without exactly one fonts.css link', () => {
  assert.throws(() => applyPreloads(page({ fontsLink: '' }), ''), /found 0/);
});

test('render on the real homepage is a no-op today', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal(render(html, 'index.html'), html);
});
