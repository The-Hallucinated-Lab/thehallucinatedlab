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
const { loadPure } = require('./helpers/load-pure');

const {
  PER_PAGE, letterOf, filterByLetter, pageCount, clampPage, sliceBounds,
  pageWindow, rangeLabel,
} = loadPure('dictionary/assets/js/browse.js', [
  'PER_PAGE', 'letterOf', 'filterByLetter', 'pageCount', 'clampPage',
  'sliceBounds', 'pageWindow', 'rangeLabel',
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
