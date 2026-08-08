/* ============================================================
   dev-mode.test.js — the dev/live split.

   The property worth protecting is asymmetric: showing unfinished work to
   a visitor is a real failure, while failing to show it to a founder is a
   minor annoyance. Every test here is written from the direction of "can
   dev content escape", not "does the toggle work".

   The CSS carries the hiding rule rather than the JS, deliberately: the
   CSP forbids inline script, so the earliest JS can run is a deferred
   file, which is after paint. A "hide when live" rule would flash
   unfinished work at every visitor before JS could remove it.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('styles.css');
const js = read('script.js');
const manifest = JSON.parse(read('spec/manifest.json'));

const { normalizeMode, navEntryVisible, isModeToggle, otherMode } =
  loadPure('script.js', ['normalizeMode', 'navEntryVisible', 'isModeToggle', 'otherMode']);

test('dev content is hidden by default, not hidden by script', () => {
  assert.match(css, /\[data-status="dev"\]\s*\{\s*display:\s*none\s*!important/,
    'dev content must default to hidden in CSS, or it flashes before JS runs');
});

test('only data-mode="dev" reveals it', () => {
  assert.match(css, /:root\[data-mode="dev"\]\s*\[data-status="dev"\]\s*\{\s*display:\s*revert/,
    'the reveal must be gated on the mode attribute');
});

test('script cannot unhide dev content by stripping the marker', () => {
  /* JS may only add data-mode. If it could remove data-status, a bug
     there would expose everything at once. */
  assert.doesNotMatch(js, /removeAttribute\(\s*['"]data-status['"]\s*\)/,
    'script must not remove the dev marker');
});

test('anything unrecognised resolves to live', () => {
  assert.equal(normalizeMode(null), 'live', 'no stored value means live');
  assert.equal(normalizeMode(undefined), 'live', 'undefined means live');
  assert.equal(normalizeMode(''), 'live', 'empty means live');
  assert.equal(normalizeMode('nonsense'), 'live', 'an unknown value means live');
  assert.equal(normalizeMode('DEV'), 'live', 'case must not smuggle dev mode in');
  assert.equal(normalizeMode('dev'), 'dev', 'the exact value is honoured');
});

test('only Ctrl+Alt+Backslash toggles the mode', () => {
  /* Modifiers are checked exhaustively rather than loosely, so the
     shortcut cannot fire as a subset of a larger chord the browser or
     the OS already owns. */
  const press = extra => Object.assign(
    { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, code: 'Backslash' }, extra);

  assert.equal(isModeToggle(press()), true, 'the exact chord fires');
  assert.equal(isModeToggle(press({ shiftKey: true })), false, 'shift must not fire it');
  assert.equal(isModeToggle(press({ metaKey: true })), false, 'meta must not fire it');
  assert.equal(isModeToggle(press({ ctrlKey: false })), false, 'ctrl is required');
  assert.equal(isModeToggle(press({ altKey: false })), false, 'alt is required');
  assert.equal(isModeToggle(press({ code: 'Slash' })), false, 'another key must not fire it');
  assert.equal(isModeToggle(null), false, 'no event is not a toggle');
});

test('the toggle flips between exactly two modes', () => {
  /* A junk value normalises to live first, so it flips to dev — which is
     the useful direction: the next press then puts it back to live. */
  assert.equal(otherMode('live'), 'dev');
  assert.equal(otherMode('dev'), 'live');
  assert.equal(otherMode('nonsense'), 'dev');
  assert.equal(otherMode(otherMode('live')), 'live', 'two presses return to the start');
});

test('the shortcut matches the physical key, not the character', () => {
  /* Alt+backslash produces a different character on several layouts, so
     matching on event.key would work on one keyboard and quietly not on
     another. event.code is the physical key. */
  assert.match(js, /event\.code === 'Backslash'/,
    'the toggle must key off event.code');
  assert.doesNotMatch(js, /event\.key === '\\\\'/,
    'matching the character is layout-dependent');
});

test('the mode still only ever comes from storage, never from the URL', () => {
  /* A ?mode=dev switch would put unfinished work one shared link away. */
  assert.doesNotMatch(js, /searchParams\.get\(\s*['"]mode['"]\s*\)/,
    'mode must not be settable from the query string');
});

test('every tool declares a status the site can filter on', () => {
  for (const tool of manifest.tools) {
    assert.ok(['live', 'dev'].includes(tool.status),
      `${tool.name} has status ${JSON.stringify(tool.status)}; expected "live" or "dev"`);
  }
});

test('the small-model page stays behind dev mode at every entry point', () => {
  /* The three model cards describe work that is still on the bench, so
     two independent gates hold them back rather than one.

     The first gate is that every route in is dev-marked — the nav entry
     on 25 pages and the gateway card on tools.html. Asserting on all of
     them rather than on a known list is the point: the next page to
     copy the navbar gets checked for free, and a paste that drops the
     marker on one page out of twenty-five is invisible by eye.

     The second is that the page is noindex, for the visitor who reaches
     the URL some other way — an old share link, a guess, a crawler.

     Either gate can be dropped in a refactor with no visible symptom:
     the page goes on rendering perfectly, just to the wrong audience. */
  const pages = [...fs.readdirSync(ROOT), ...fs.readdirSync(path.join(ROOT, 'blogs')).map(f => `blogs/${f}`)]
    .filter(f => f.endsWith('.html'));

  const bare = [];
  for (const page of pages) {
    for (const line of read(page).split('\n')) {
      /* <a> only. The page's own canonical and og:url point at itself
         and are not a route a visitor can click. */
      if (!/<a [^>]*href="[^"]*slm\.html"/.test(line)) continue;
      if (!line.includes('data-status="dev"')) bare.push(`${page}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bare, [],
    `these links into slm.html are visible to a live visitor:\n  ${bare.join('\n  ')}`);

  /* Without this the loop above passes vacuously the day the page is
     renamed: no links found, nothing to complain about. */
  assert.ok(pages.includes('slm.html'), 'slm.html is gone — this test now checks nothing');
  assert.match(read('slm.html'), /<meta name="robots" content="noindex/,
    'slm.html must stay out of the index while its models are in training');
});

test('nav entries default to live and dev entries need dev mode', () => {
  assert.equal(navEntryVisible({ label: 'Convert' }, 'live'), true, 'no status means live');
  assert.equal(navEntryVisible({ label: 'X', status: 'dev' }, 'live'), false,
    'a dev entry must not render in live mode');
  assert.equal(navEntryVisible({ label: 'X', status: 'dev' }, 'dev'), true,
    'dev mode reveals dev entries');
  assert.equal(navEntryVisible({ label: 'Y', status: 'live' }, 'live'), true,
    'an explicit live entry renders');
});
