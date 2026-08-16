/* ============================================================
   dictionary-browse.test.js — the letter filter and the pager.

   These cover the decisions, not the rendering: which entries a letter
   selects, how many pages that makes, which page you end up on when the
   filter narrows under you, and which buttons the pager offers. All of
   it is pure, so it runs under node with no DOM.

   The regression that motivated most of it: choosing a letter used to be
   an anchor jump down a 7,000px page. Filtering in place means the page
   number and the filter can now disagree — pick 'S', walk to page 3,
   then pick 'A' — and clampPage is the thing that stops that showing an
   empty grid.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const {
  PER_PAGE, letterOf, filterByLetter, pageCount, clampPage, sliceBounds,
  pageWindow, rangeLabel, encodeState, decodeState, sortEntries,
} = loadPure('dictionary/assets/js/browse.js', [
  'PER_PAGE', 'letterOf', 'filterByLetter', 'pageCount', 'clampPage',
  'sliceBounds', 'pageWindow', 'rangeLabel', 'encodeState', 'decodeState',
  'sortEntries',
]);

const entry = title => ({ title });
const titles = list => list.map(e => e.title);

test('a term buckets under its first letter, case-folded', () => {
  assert.equal(letterOf('Attention Mechanism'), 'A');
  assert.equal(letterOf('backpropagation'), 'B');
  assert.equal(letterOf('  softmax'), 'S', 'leading space must not become the bucket');
});

test('anything not starting with a letter buckets under #', () => {
  /* No entry looks like this today. One will: the corpora already carry
     ACID and CAP Theorem, and a "2-phase commit" or ".NET" is one
     contribution away from silently landing under an empty bucket. */
  assert.equal(letterOf('2-phase commit'), '#');
  assert.equal(letterOf(''), '#');
  assert.equal(letterOf(undefined), '#');
});

test('a letter selects only its own entries, and "all" keeps everything', () => {
  const entries = ['ACID', 'Attention', 'Backpropagation', 'Softmax'].map(entry);
  assert.deepEqual(titles(filterByLetter(entries, 'A')), ['ACID', 'Attention']);
  assert.deepEqual(titles(filterByLetter(entries, 'S')), ['Softmax']);
  assert.equal(filterByLetter(entries, 'all').length, 4);
  assert.equal(filterByLetter(entries, null).length, 4, 'no letter means no filter');
});

test('filtering returns a copy, so the caller cannot mutate the corpus', () => {
  const entries = [entry('ACID')];
  filterByLetter(entries, 'all').push(entry('injected'));
  assert.equal(entries.length, 1);
});

test('an empty result is still one page, not zero', () => {
  /* "Page 1 of 0" is the shape that makes a pager render nothing at all
     and leaves the reader with no way back. */
  assert.equal(pageCount(0), 1);
  assert.equal(rangeLabel(1, 0), 'No entries match that letter');
});

test('page count follows the real corpora', () => {
  assert.equal(PER_PAGE, 12);
  assert.equal(pageCount(21), 2, 'AI & Mathematics: 21 entries');
  assert.equal(pageCount(18), 2, 'Software Engineering Core: 18 entries');
  assert.equal(pageCount(12), 1, 'an exact page must not spill into a second');
  assert.equal(pageCount(13), 2);
});

test('a page number left over from a wider filter is clamped, never trusted', () => {
  assert.equal(clampPage(3, 4), 1, 'four entries is one page');
  assert.equal(clampPage(2, 21), 2);
  assert.equal(clampPage(99, 21), 2);
  assert.equal(clampPage(0, 21), 1);
  assert.equal(clampPage(-5, 21), 1);
  assert.equal(clampPage(NaN, 21), 1, 'a parsed-from-nothing page must not blank the grid');
});

test('slice bounds never run past the end of the last page', () => {
  assert.deepEqual(sliceBounds(1, 21), { start: 0, end: 12 });
  assert.deepEqual(sliceBounds(2, 21), { start: 12, end: 21 }, 'short last page');
  assert.deepEqual(sliceBounds(2, 24), { start: 12, end: 24 }, 'exact last page');
  assert.deepEqual(sliceBounds(9, 21), { start: 12, end: 21 }, 'clamped, not out of range');
});

test('every entry appears exactly once across all pages', () => {
  const entries = Array.from({ length: 21 }, (_, i) => entry(`term-${i}`));
  const seen = [];
  for (let p = 1; p <= pageCount(entries.length); p++) {
    const { start, end } = sliceBounds(p, entries.length);
    seen.push(...entries.slice(start, end));
  }
  assert.equal(seen.length, entries.length);
  assert.equal(new Set(titles(seen)).size, entries.length, 'no entry duplicated or dropped');
});

test('the pager lists every page while they still fit', () => {
  assert.deepEqual(pageWindow(1, 21), [1, 2]);
  assert.deepEqual(pageWindow(1, 84), [1, 2, 3, 4, 5, 6, 7]);
});

test('a long corpus keeps the first and last page one click away', () => {
  const first = pageWindow(1, 300);
  const middle = pageWindow(13, 300);
  const last = pageWindow(25, 300);
  for (const [name, w] of [['first', first], ['middle', middle], ['last', last]]) {
    assert.equal(w[0], 1, `${name}: page 1 must always be reachable`);
    assert.equal(w[w.length - 1], 25, `${name}: last page must always be reachable`);
    assert.ok(w.length <= 7, `${name}: window grew past its button budget (${w.length})`);
  }
  assert.ok(middle.includes(13), 'the current page must be in its own window');
  assert.ok(middle.includes(0), 'a skipped run must be marked with a gap');
});

test('a gap is never used to hide a single page', () => {
  /* "1 … 3 … 25" is worse than "1 2 3 … 25": the ellipsis costs the same
     space as the number it is standing in for. */
  for (let page = 1; page <= 25; page++) {
    const w = pageWindow(page, 300);
    for (let i = 0; i < w.length; i++) {
      if (w[i] !== 0) continue;
      const before = w[i - 1], after = w[i + 1];
      assert.ok(after - before > 1,
        `page ${page}: gap between ${before} and ${after} hides nothing`);
    }
  }
});

test('the announced range is one-based and inclusive', () => {
  assert.equal(rangeLabel(1, 21), 'Showing 1–12 of 21');
  assert.equal(rangeLabel(2, 21), 'Showing 13–21 of 21');
  assert.equal(rangeLabel(1, 5), 'Showing 1–5 of 5');
});

/* ---- URL state ----
   Each section keeps its filter in a query parameter so that Back undoes
   a filter rather than leaving the dictionary, and so a narrowed view is
   a shareable link. That makes the parameter an input from outside the
   program: it arrives hand-edited, truncated and stale, and none of
   those may blank the grid. */

test('the default view puts nothing in the URL', () => {
  assert.equal(encodeState('all', 1), '');
  assert.equal(encodeState(null, 1), '');
});

test('a filter or a page beyond the first round-trips', () => {
  for (const [letter, page] of [['E', 1], ['E', 3], ['all', 2], ['#', 1]]) {
    const decoded = decodeState(encodeState(letter, page));
    assert.deepEqual(decoded, { letter, page }, `${letter}.${page} did not survive`);
  }
});

test('deep in the unfiltered corpus still round-trips', () => {
  /* encodeState emits "all.2" here — the one form where the letter is
     ALL but the parameter is not empty. An earlier validator rejected it
     and silently threw the reader back to page 1. */
  assert.equal(encodeState('all', 2), 'all.2');
  assert.deepEqual(decodeState('all.2'), { letter: 'all', page: 2 });
});

test('an absent parameter is the full corpus, not an error', () => {
  assert.deepEqual(decodeState(''), { letter: 'all', page: 1 });
  assert.deepEqual(decodeState(null), { letter: 'all', page: 1 });
  assert.deepEqual(decodeState(undefined), { letter: 'all', page: 1 });
});

test('a malformed letter drops its page instead of honouring it', () => {
  /* The page number was a position inside a filter that does not exist.
     Keeping it lands the reader on page 2 of a corpus they never asked
     to page through — which is what "?x=ññ.99" used to do. */
  assert.deepEqual(decodeState('ññ.99'), { letter: 'all', page: 1 });
  assert.deepEqual(decodeState('EE.2'), { letter: 'all', page: 1 });
  assert.deepEqual(decodeState('<script>.1'), { letter: 'all', page: 1 });
});

test('a bad page on a good letter keeps the letter', () => {
  assert.deepEqual(decodeState('E.nonsense'), { letter: 'E', page: 1 });
  assert.deepEqual(decodeState('E'), { letter: 'E', page: 1 });
  assert.deepEqual(decodeState('E.-4'), { letter: 'E', page: 1 });
  assert.deepEqual(decodeState('E.0'), { letter: 'E', page: 1 });
});

test('a lowercase letter in a hand-typed URL still works', () => {
  assert.deepEqual(decodeState('e.2'), { letter: 'E', page: 2 });
});

/* ---- ordering ---- */

test('entries are alphabetical regardless of markup order', () => {
  const scrambled = ['Softmax', 'ACID', 'entropy', 'Backpropagation'].map(entry);
  assert.deepEqual(titles(sortEntries(scrambled)),
    ['ACID', 'Backpropagation', 'entropy', 'Softmax']);
});

test('sorting does not mutate the caller\'s array', () => {
  const entries = ['Softmax', 'ACID'].map(entry);
  sortEntries(entries);
  assert.deepEqual(titles(entries), ['Softmax', 'ACID']);
});

test('paging slices the sorted order, not the markup order', () => {
  /* Paging takes a slice, so if the sort and the slice disagree the
     reader gets a page of entries that were never adjacent. */
  const scrambled = Array.from({ length: 20 }, (_, i) => entry(`term-${String(19 - i).padStart(2, '0')}`));
  const sorted = sortEntries(scrambled);
  const { start, end } = sliceBounds(1, sorted.length);
  assert.equal(titles(sorted.slice(start, end))[0], 'term-00');
});

/* ---- the filter has to actually hide something ----
   This is a CSS assertion rather than a behavioural one because the bug
   it guards was invisible to every behavioural check written against the
   DOM. browse.js hides a card by setting the `hidden` attribute, whose
   `display: none` comes from the UA stylesheet — and any author rule
   setting `display` beats it. `.entry-card { display: block }` did, so
   filtering set the attribute on 18 of 21 cards, updated the count and
   the status line, and left all 21 painted on screen. Asserting on the
   property told you nothing; only the rendered box did. */

test('a hidden entry card is actually hidden by the stylesheet', () => {
  const css = fs.readFileSync(path.join(ROOT, 'dictionary/assets/css/dictionary.css'), 'utf8');
  assert.match(css, /\.corpus-grid\s+\.entry-card\[hidden\]\s*\{\s*display:\s*none/,
    'nothing overrides .entry-card display:block for [hidden] cards — the letter filter will set the attribute and change nothing on screen');
});

test('the rule outranks the .entry-card display it has to beat', () => {
  /* If .entry-card ever stops setting display, this rule is redundant
     rather than wrong — but while it does, the override must be more
     specific, and specificity is the entire reason this works. */
  const css = fs.readFileSync(path.join(ROOT, 'dictionary/assets/css/dictionary.css'), 'utf8');
  const setsDisplay = /\.entry-card\s*\{[^}]*display:/.test(css);
  if (!setsDisplay) return;
  const override = css.match(/(\.corpus-grid\s+\.entry-card\[hidden\])/);
  assert.ok(override, 'the [hidden] override is gone while .entry-card still sets display');
  assert.ok(override[1].split(/[.[]/).length - 1 >= 3,
    'the override must carry more specificity than .entry-card alone');
});
