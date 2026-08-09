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

const { normalizeMode, navEntryVisible, isModeToggle, otherMode, isDevTap, nextTapCount } =
  loadPure('script.js',
    ['normalizeMode', 'navEntryVisible', 'isModeToggle', 'otherMode', 'isDevTap', 'nextTapCount']);

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

test('only Ctrl+Alt+Backslash toggles the mode from a keyboard', () => {
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

test('the triple tap is touch-only, so a mouse cannot reach dev mode', () => {
  /* This is the whole safety argument for the gesture. A triple click
     is how you select a paragraph on a desktop, and the footer line is
     a paragraph — accepting a mouse here would hand dev mode to a
     visitor for doing the most ordinary thing there is to do to text.
     A machine with a mouse has Ctrl+Alt+\ already, so the restriction
     costs nothing. */
  assert.equal(isDevTap({ pointerType: 'touch' }), true, 'a finger is the intended input');
  assert.equal(isDevTap({ pointerType: 'mouse' }), false, 'a mouse must not fire it');
  assert.equal(isDevTap({ pointerType: 'pen' }), false, 'a stylus must not fire it');
  assert.equal(isDevTap({}), false, 'an event with no pointerType is not a tap');
  assert.equal(isDevTap(null), false, 'no event is not a tap');
});

test('the gesture does not ride on the browser\'s own click counter', () => {
  /* MouseEvent.detail === 3 is the ready-made triple click, and reaching
     for it would silently undo the rule above: it counts mouse clicks,
     which is exactly the input that must not work here. */
  assert.doesNotMatch(js, /\.detail\s*===\s*3/,
    'the tap count must be counted from touch pointers, not from the click counter');
  assert.match(js, /addEventListener\('pointerdown'/,
    'the gesture listens for pointer events, which is what carries pointerType');
});

test('the tap target is not left where the platform can eat the gesture', () => {
  /* Both of these read as idle styling on a footer and would survive any
     tidy-up unchallenged, but the gesture does not work on an iPhone
     without them: double-tap zoom takes the second tap and moves the
     page out from under the third, and the text-selection callout draws
     over the element being tapped. The symptom is "the triple tap does
     nothing", on one platform, which is exactly the report that took a
     round trip to a real phone to get. */
  assert.match(css, /footer\s*\{[^}]*touch-action:\s*manipulation/,
    'the footer must opt out of double-tap zoom, or taps two and three are lost to it');
  assert.match(css, /footer\s*\{[^}]*user-select:\s*none/,
    'the footer must not raise a selection callout over the element being tapped');
});

test('three taps only count together when they are close together', () => {
  /* Whether the timer happens to have fired is not the thing under
     test — the count itself has to be able to tell a sequence from
     three unrelated taps, or a slow triple tap on a scrolling page
     becomes a toggle. */
  const W = 500;
  assert.equal(nextTapCount(0, 0, 1000, W), 1, 'the first tap starts the sequence');
  assert.equal(nextTapCount(1, 1000, 1300, W), 2, 'a tap inside the window continues it');
  assert.equal(nextTapCount(2, 1300, 1600, W), 3, 'the third completes it');
  assert.equal(nextTapCount(2, 1300, 2600, W), 1,
    'a tap after the window starts over rather than completing a stale sequence');
  assert.equal(nextTapCount(1, 1000, 1500, W), 2, 'exactly on the window still counts');
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

test('every navbar carries the same dev group, in the same order', () => {
  /* This drifted once and nobody saw it: five pages sat without any dev
     entries at all while the other twenty had three, so which unfinished
     sections existed depended on which page you happened to be standing
     on when you pressed the shortcut. Nothing renders wrong when this
     breaks — the bar just quietly disagrees with itself, and only in a
     mode most visitors never enter, which is why it went unnoticed.

     Order is part of it. The group is read as a list of what is being
     worked on, and a list that reshuffles between pages reads as a
     different list. */
  const norm = href => href.replace(/^(\.\.\/|\/)/, '');
  const devGroup = (nav) =>
    [...nav.matchAll(/<li data-status="dev"><a href="([^"]+)"/g)].map(m => norm(m[1]));

  const found = new Map();
  for (const dir of ['.', 'blogs']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.html')) continue;
      const page = dir === '.' ? f : `${dir}/${f}`;
      const html = read(page);
      /* Redirect stubs are gone before a bar is any use, and a page with
         no navbar has nothing to disagree about. */
      if (/http-equiv=["']refresh["']/i.test(html)) continue;
      const nav = html.match(/<ul class="nav-links"[^>]*>[\s\S]*?<\/ul>/);
      if (!nav) continue;
      found.set(page, devGroup(nav[0]));
    }
  }

  const expected = found.get('index.html');
  assert.ok(expected && expected.length > 0,
    'index.html has no dev entries — this test now checks nothing');

  const drifted = [...found]
    .filter(([, group]) => group.join() !== expected.join())
    .map(([page, group]) => `${page}: [${group.join(', ')}]`);

  assert.deepEqual(drifted, [],
    `these navbars disagree with index.html's [${expected.join(', ')}]:\n  ${drifted.join('\n  ')}`);
});

/* Pages that exist but are not for visitors yet. Each is reachable only
   from a dev-marked link, and each is noindex so a visitor who arrives
   by some other route is not indexed into finding it. */
const DEV_ONLY_PAGES = ['slm.html', 'genai.html'];

test('an unfinished page stays behind dev mode at every entry point', () => {
  /* The pages in DEV_ONLY_PAGES describe work still on the bench, so two
     independent gates hold them back rather than one.

     The first gate is that every route in is dev-marked — the nav entry
     on 25 pages, the gateway card on tools.html. Asserting on all of them
     rather than on a known list is the point: the next page to copy the
     navbar gets checked for free, and a paste that drops the marker on
     one page out of twenty-five is invisible by eye.

     The second is that the page is noindex, for the visitor who reaches
     the URL some other way — an old share link, a guess, a crawler.

     Either gate can be dropped in a refactor with no visible symptom:
     the page goes on rendering perfectly, just to the wrong audience. */
  const pages = [...fs.readdirSync(ROOT), ...fs.readdirSync(path.join(ROOT, 'blogs')).map(f => `blogs/${f}`)]
    .filter(f => f.endsWith('.html'));

  const bare = [];
  for (const target of DEV_ONLY_PAGES) {
    /* Without this the loop below passes vacuously the day the page is
       renamed: no links found, nothing to complain about. */
    assert.ok(pages.includes(target), `${target} is gone — this test now checks nothing`);

    const linkPattern = new RegExp(`<a [^>]*href="[^"]*${target.replace('.', '\\.')}"`);
    for (const page of pages) {
      for (const line of read(page).split('\n')) {
        /* <a> only. The page's own canonical and og:url point at itself
           and are not a route a visitor can click. */
        if (!linkPattern.test(line)) continue;
        if (!line.includes('data-status="dev"')) bare.push(`${page} -> ${target}: ${line.trim()}`);
      }
    }

    assert.match(read(target), /<meta name="robots" content="noindex/,
      `${target} must stay out of the index while it is on the bench`);
  }

  assert.deepEqual(bare, [],
    `these links into a dev-only page are visible to a live visitor:\n  ${bare.join('\n  ')}`);
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
