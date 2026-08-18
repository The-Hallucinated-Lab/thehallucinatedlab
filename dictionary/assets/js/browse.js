/**
 * browse.js — letter filtering and paging for the two corpus grids.
 *
 * Replaces the jump-to-anchor alphabet. The old .alpha-nav was a row of
 * `#letter-X` links into a 7,000px page, so choosing a letter threw the
 * reader down the document and left them to scroll back. Here a letter
 * *filters in place*: the page never moves, and the grid under the
 * alphabet becomes exactly the entries you asked for.
 *
 * Progressive enhancement, deliberately. The markup still ships real
 * anchors and every card is visible with JavaScript off — that is the
 * no-JS reading experience and it is unchanged. This file intercepts the
 * clicks and takes over only once it is running, which is also why the
 * controls it adds are created here rather than sitting in the HTML
 * doing nothing for a reader who never gets them.
 */

/* @pure-start
   No DOM, no storage, no network below this line — the paging and
   filtering decisions are all here so they can be tested under node. */

/* Twelve fills the 3-column grid exactly four rows deep, so a page turn
   never leaves a ragged last row mid-corpus. Both corpora (21 and 18
   entries) land on two pages. */
const PER_PAGE = 12;

const ALL = 'all';

/** First letter of a term, uppercased. Non-letters bucket under '#'. */
function letterOf(title) {
  const ch = String(title || '').trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

/** Entries whose term starts with `letter`; ALL keeps everything. */
function filterByLetter(entries, letter) {
  if (!letter || letter === ALL) return entries.slice();
  return entries.filter(e => letterOf(e.title) === letter);
}

/** How many pages `total` items need. Always at least one, so an empty
    result still renders "page 1 of 1" rather than "of 0". */
function pageCount(total, perPage = PER_PAGE) {
  return Math.max(1, Math.ceil(total / perPage));
}

/** Clamp a requested page into range. Guards a stale page number left
    over from a wider filter — pick 'Z', land on page 3, switch to 'A'. */
function clampPage(page, total, perPage = PER_PAGE) {
  const last = pageCount(total, perPage);
  const n = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(n, 1), last);
}

/** Zero-based [start, end) slice bounds for a page. */
function sliceBounds(page, total, perPage = PER_PAGE) {
  const p = clampPage(page, total, perPage);
  const start = (p - 1) * perPage;
  return { start, end: Math.min(start + perPage, total) };
}

/**
 * The page buttons to render: numbers, with 0 standing for a gap.
 * Always shows first and last so the ends of the corpus stay one click
 * away; window slides around the current page in between.
 */
function pageWindow(page, total, perPage = PER_PAGE, maxButtons = 7) {
  const last = pageCount(total, perPage);
  const current = clampPage(page, total, perPage);
  if (last <= maxButtons) {
    return Array.from({ length: last }, (_, i) => i + 1);
  }
  const span = maxButtons - 4;                 // room for 1, gap, gap, last
  let from = Math.max(2, current - Math.floor(span / 2));
  const to = Math.min(last - 1, from + span - 1);
  from = Math.max(2, to - span + 1);

  const out = [1];
  if (from > 2) out.push(0);
  for (let i = from; i <= to; i++) out.push(i);
  if (to < last - 1) out.push(0);
  out.push(last);
  return out;
}

/** "Showing 1–12 of 21" — the text the live region announces. */
function rangeLabel(page, total, perPage = PER_PAGE) {
  if (total === 0) return 'No entries match that letter';
  const { start, end } = sliceBounds(page, total, perPage);
  return `Showing ${start + 1}–${end} of ${total}`;
}

/** Serialise a section's state for the URL: "E.2", or "" when default. */
function encodeState(letter, page) {
  if ((!letter || letter === ALL) && page <= 1) return '';
  return `${letter || ALL}.${page}`;
}

/**
 * Parse "E.2" back, and "all.2" — encodeState emits that form whenever
 * the reader is deep in the unfiltered corpus, so it has to round-trip.
 *
 * A hand-edited or truncated URL must never blank the grid, so anything
 * unrecognised falls back to the whole corpus at page 1. The page is
 * dropped along with a bad letter rather than kept: it was a position
 * within a filter that no longer exists, and honouring it lands the
 * reader on page 2 of a corpus they did not ask to page through.
 */
function decodeState(raw) {
  const [letterPart = '', pagePart] = String(raw || '').split('.');
  const upper = letterPart.toUpperCase();
  const valid = upper === ALL.toUpperCase() || /^[A-Z#]$/.test(upper);
  if (letterPart !== '' && !valid) return { letter: ALL, page: 1 };

  const page = Number.parseInt(pagePart, 10);
  return {
    letter: valid && upper !== ALL.toUpperCase() ? upper : ALL,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Alphabetical by term, so the grid order never depends on the order
    the markup happens to be generated in. */
function sortEntries(entries) {
  return entries.slice().sort((a, b) =>
    String(a.title).localeCompare(String(b.title), 'en', { sensitivity: 'base' }));
}

/* @pure-end */

/* ---------- DOM wiring ---------- */

/* Matches the site's own .fade-in cadence in styles.css: a short stagger
   that stops well before the last card, so a full page never feels like
   it is being dealt out one card at a time. */
const STAGGER_MS = 28;
const STAGGER_CAP = 10;

/* Each section owns one query parameter keyed by its id, e.g.
   ?ai-mathematics=E.2 — so the two corpora keep independent state, a
   filtered view is a shareable link, and most importantly Back undoes a
   filter instead of leaving the page. Without this the browser's Back
   button is the reader's instinctive way out of a narrowed grid and it
   takes them off the dictionary entirely. */
function readParam(id) {
  return new URLSearchParams(window.location.search).get(id) || '';
}

function writeParam(id, value, { replace = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(id, value); else params.delete(id);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  /* replaceState for the initial read so the first entry in the session
     history is not a duplicate of the page the reader arrived on. */
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function setupSection(section) {
  const grid = section.querySelector('.corpus-grid');
  const alpha = section.querySelector('.alpha-nav');
  if (!grid || !alpha) return;

  const cards = [...grid.querySelectorAll('.entry-card')];
  if (!cards.length) return;

  /* Sorted rather than trusted: the corpora happen to be alphabetical in
     the markup today, but paging slices this array, so the order it is in
     is the order the reader gets. `order` keeps the painted grid in step
     with the array without moving any nodes. */
  const entries = sortEntries(cards.map(el => ({
    el,
    title: (el.querySelector('h3')?.textContent || '').trim(),
  })));
  entries.forEach(({ el }, i) => { el.style.order = String(i); });

  const countEl = section.querySelector('.results-count');
  const totalEntries = entries.length;

  /* Why the page stays put: the alphabet ships as real anchors so it
     still works without JavaScript, and preventDefault on the click is
     what stops the jump once this file is running. That is the whole
     mechanism — measured across six positions, including mid-document
     and at the very bottom, the offset does not move.

     Two things were tried here and removed rather than left in: saving
     and restoring window.scrollY around each render, and
     `overflow-anchor: none` on the grid. Both were written against a
     ~2,800px lurch that turned out to be the test harness scrolling the
     element into view before clicking it, not the page. With the
     measurement fixed, neither changed the result, so neither is here. */

  const state = { letter: ALL, page: 1 };

  /* --- controls --- */
  const controls = document.createElement('nav');
  controls.className = 'corpus-pager';
  controls.setAttribute('aria-label', 'Entry pages');

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'pager-step';
  prev.textContent = 'Previous';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'pager-step';
  next.textContent = 'Next';

  const numbers = document.createElement('div');
  numbers.className = 'pager-numbers';

  controls.append(prev, numbers, next);

  const status = document.createElement('p');
  status.className = 'corpus-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  grid.after(controls);
  controls.after(status);

  /* --- an "All" control, so a chosen letter can be undone --- */
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'alpha-all';
  allBtn.textContent = 'All';
  alpha.prepend(allBtn);

  /* Letters with no entries are already <span> in the markup; only the
     <a> elements are live, and those become filter controls. */
  const letterLinks = [...alpha.querySelectorAll('a')];

  function render({ animate = true, pushHistory = false } = {}) {
    const matching = filterByLetter(entries, state.letter);
    state.page = clampPage(state.page, matching.length);
    const { start, end } = sliceBounds(state.page, matching.length);
    const visible = new Set(matching.slice(start, end).map(e => e.el));

    let i = 0;
    for (const { el } of entries) {
      const show = visible.has(el);
      el.hidden = !show;
      if (!show) { el.style.removeProperty('--card-delay'); continue; }
      el.style.setProperty('--card-delay', `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms`);
      i++;
    }

    if (animate) {
      /* Restart the entry animation without a reflow-per-card: drop the
         class, force one style read, add it back. */
      grid.classList.remove('is-entering');
      void grid.offsetWidth;
      grid.classList.add('is-entering');
    }

    const pages = pageCount(matching.length);
    /* Always rendered, never hidden on a short result. The controls are
       how the reader knows whether there is more — a pager that vanishes
       when a letter matches three entries reads as "the page broke",
       not as "this is all of them". */
    controls.hidden = false;
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= pages;

    numbers.replaceChildren(...pageWindow(state.page, matching.length).map((n) => {
      if (n === 0) {
        const gap = document.createElement('span');
        gap.className = 'pager-gap';
        gap.textContent = '…';
        return gap;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pager-num';
      b.textContent = String(n);
      b.setAttribute('aria-label', `Page ${n}`);
      if (n === state.page) {
        b.setAttribute('aria-current', 'page');
        b.classList.add('is-current');
      }
      b.addEventListener('click', () => { state.page = n; render({ pushHistory: true }); });
      return b;
    }));

    for (const a of letterLinks) {
      const on = a.dataset.letter === state.letter;
      a.classList.toggle('is-active', on);
      a.setAttribute('aria-pressed', String(on));
    }
    allBtn.classList.toggle('is-active', state.letter === ALL);
    allBtn.setAttribute('aria-pressed', String(state.letter === ALL));

    if (pushHistory) {
      writeParam(section.id, encodeState(state.letter, state.page));
    }

    const scope = state.letter === ALL ? '' : ` starting with ${state.letter}`;
    status.textContent = `${rangeLabel(state.page, matching.length)}${scope}.`;
    if (countEl) {
      countEl.textContent = state.letter === ALL
        ? `${totalEntries} entries`
        : `${matching.length} of ${totalEntries}`;
    }
  }

  for (const a of letterLinks) {
    /* "#letter-A" -> "A". Kept as the href so the anchor still works for
       a reader without JavaScript. */
    const letter = (a.getAttribute('href') || '').replace('#letter-', '').toUpperCase();
    a.dataset.letter = letter;
    a.setAttribute('role', 'button');
    a.setAttribute('aria-pressed', 'false');
    a.addEventListener('click', (event) => {
      event.preventDefault();          // the whole point: no jump
      state.letter = state.letter === letter ? ALL : letter;
      state.page = 1;
      render({ pushHistory: true });
    });
  }

  allBtn.addEventListener('click', () => {
    state.letter = ALL;
    state.page = 1;
    render({ pushHistory: true });
  });

  prev.addEventListener('click', () => { state.page -= 1; render({ pushHistory: true }); });
  next.addEventListener('click', () => { state.page += 1; render({ pushHistory: true }); });

  /* Adopt whatever the URL already says — a shared link, a reload, or a
     Back that landed here. */
  function adoptFromUrl({ animate }) {
    const { letter, page } = decodeState(readParam(section.id));
    state.letter = letter;
    state.page = page;
    render({ animate });
  }

  window.addEventListener('popstate', () => adoptFromUrl({ animate: true }));

  section.classList.add('is-enhanced');
  adoptFromUrl({ animate: false });
}

for (const section of document.querySelectorAll('.section')) {
  setupSection(section);
}
