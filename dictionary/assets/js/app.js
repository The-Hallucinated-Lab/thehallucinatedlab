/**
 * Dictionary hub controller.
 *
 * Wires the search bar to the engine. The page already contains both corpora as
 * static HTML, so everything here is progressive enhancement — with JavaScript
 * off the sections and every term page still browse correctly (RULE-08).
 *
 * Rule 602: suggestions trigger from the 3rd keystroke.
 * Rule 724: keystrokes are debounced by 150ms.
 * Rule 725: results are capped at 20 with a "load more" continuation.
 */
import { SearchEngine } from './search-engine.js';

const DEBOUNCE_MS = 150;
const SUGGEST_AFTER = 3;
const PAGE_SIZE = 20;

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const clearBtn = document.getElementById('search-clear');
const suggestList = document.getElementById('search-suggest');
const scopeButtons = [...document.querySelectorAll('.scope-btn')];

const resultsBlock = document.getElementById('results-block');
const resultsTitle = document.getElementById('results-title');
const resultsCount = document.getElementById('results-count');
const resultsGrid = document.getElementById('results-grid');
const resultsMore = document.getElementById('results-more');
const resultsSuggestion = document.getElementById('results-suggestion');
const browse = document.getElementById('browse');

let engine = null;
let scope = 'all';
let activeSuggestion = -1;
let shown = 0;
let lastQuery = '';

/* ------------------------------------------------------------------ */

init();

async function init() {
  if (!form) return;
  try {
    const response = await fetch('data/search-index.json');
    if (!response.ok) throw new Error(`index ${response.status}`);
    engine = new SearchEngine(await response.json());
  } catch (error) {
    // A failed index must not take the page down — the static lists still work.
    console.error('Search index unavailable:', error);
    input.disabled = true;
    input.placeholder = 'Search unavailable — browse the sections below';
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    closeSuggestions();
    runSearch(input.value);
  });

  input.addEventListener('input', debounce(onType, DEBOUNCE_MS));
  input.addEventListener('keydown', onKeyDown);
  clearBtn.addEventListener('click', reset);

  scopeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      scope = button.dataset.scope;
      scopeButtons.forEach((b) =>
        b.setAttribute('aria-pressed', String(b === button)));
      if (input.value.trim()) runSearch(input.value);
    });
  });

  document.addEventListener('click', (event) => {
    if (!form.contains(event.target)) closeSuggestions();
  });

  // Rule: a shared URL must reproduce the result. Also backs the SearchAction
  // declared in the hub's JSON-LD.
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    input.value = initial;
    clearBtn.classList.add('visible');
    runSearch(initial);
  }
}

/* ------------------------------- typing ------------------------------- */

function onType() {
  const value = input.value.trim();
  clearBtn.classList.toggle('visible', value.length > 0);

  if (!value) {
    reset();
    return;
  }
  if (value.length < SUGGEST_AFTER) {
    closeSuggestions();
    return;
  }
  renderSuggestions(engine.suggest(value, { scope, limit: 8 }));
}

function onKeyDown(event) {
  const items = [...suggestList.querySelectorAll('.suggest-item')];

  if (event.key === 'Escape') {
    closeSuggestions();
    return;
  }
  if (!items.length) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    activeSuggestion = (activeSuggestion + step + items.length) % items.length;
    items.forEach((item, i) => item.classList.toggle('active', i === activeSuggestion));
    items[activeSuggestion].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && activeSuggestion >= 0) {
    event.preventDefault();
    items[activeSuggestion].querySelector('a').click();
  }
}

/* ---------------------------- suggestions ---------------------------- */

function renderSuggestions(entries) {
  suggestList.textContent = '';
  activeSuggestion = -1;

  if (!entries.length) {
    closeSuggestions();
    return;
  }

  const query = input.value.trim();
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'suggest-item';
    li.setAttribute('role', 'option');

    const link = document.createElement('a');
    link.href = `terms/${entry.slug}.html`;

    const term = document.createElement('span');
    term.className = 'suggest-term';
    highlight(term, entry.term, query);

    const meta = document.createElement('span');
    meta.className = 'suggest-meta';
    meta.textContent = `${sectionName(entry.section)} · ${entry.domain}`;

    const gloss = document.createElement('span');
    gloss.className = 'suggest-gloss';
    gloss.textContent = entry.gloss;

    link.append(term, meta, gloss);
    li.append(link);
    suggestList.append(li);
  }

  suggestList.classList.add('open');
  input.setAttribute('aria-expanded', 'true');
}

function closeSuggestions() {
  suggestList.classList.remove('open');
  suggestList.textContent = '';
  input.setAttribute('aria-expanded', 'false');
  activeSuggestion = -1;
}

/** Marks the matched prefix without ever assigning user input to innerHTML. */
function highlight(container, text, query) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || !query) {
    container.textContent = text;
    return;
  }
  container.append(document.createTextNode(text.slice(0, at)));
  const mark = document.createElement('mark');
  mark.textContent = text.slice(at, at + query.length);
  container.append(mark, document.createTextNode(text.slice(at + query.length)));
}

/* ------------------------------- results ------------------------------- */

function runSearch(rawQuery) {
  const query = rawQuery.trim();
  if (!query) {
    reset();
    return;
  }

  lastQuery = query;
  shown = 0;
  resultsGrid.textContent = '';
  resultsMore.textContent = '';
  resultsSuggestion.textContent = '';

  const { results, total, suggestion } = engine.search(query, {
    scope, limit: PAGE_SIZE, offset: 0
  });

  resultsBlock.classList.add('active');
  browse.hidden = true;
  resultsTitle.textContent = `“${query}”`;
  resultsCount.textContent = total === 0
    ? 'no matches'
    : `${total} match${total === 1 ? '' : 'es'} in ${scopeName()}`;

  // Rule 601: offer a correction rather than a bare empty state.
  if (suggestion && suggestion.toLowerCase() !== query.toLowerCase()) {
    const wrapper = document.createElement('p');
    wrapper.className = 'did-you-mean';
    wrapper.append(document.createTextNode('Did you mean '));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = suggestion;
    button.addEventListener('click', () => {
      input.value = suggestion;
      runSearch(suggestion);
    });
    wrapper.append(button, document.createTextNode('?'));
    resultsSuggestion.append(wrapper);
  }

  if (!total) {
    const empty = document.createElement('p');
    empty.className = 'results-empty';
    empty.textContent = 'Nothing matched. Try a shorter query, or browse the sections below.';
    resultsGrid.append(empty);
    browse.hidden = false;
    return;
  }

  appendResults(results, total);
  resultsBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function appendResults(results, total) {
  for (const entry of results) resultsGrid.append(resultCard(entry));
  shown += results.length;

  resultsMore.textContent = '';
  if (shown < total) {
    const button = document.createElement('button');
    button.className = 'pill';
    button.type = 'button';
    button.textContent = `Load ${Math.min(PAGE_SIZE, total - shown)} more`;
    button.addEventListener('click', () => {
      const next = engine.search(lastQuery, {
        scope, limit: PAGE_SIZE, offset: shown
      });
      appendResults(next.results, next.total);
    });
    resultsMore.append(button);
  }
}

function resultCard(entry) {
  const card = document.createElement('a');
  card.className = 'entry-card';
  card.href = `terms/${entry.slug}.html`;

  const top = document.createElement('div');
  top.className = 'entry-card-top';
  const domain = document.createElement('span');
  domain.className = 'entry-card-domain';
  domain.textContent = entry.domain;
  const lid = document.createElement('span');
  lid.className = 'entry-card-lid';
  lid.textContent = entry.lid;
  top.append(domain, lid);

  const heading = document.createElement('h3');
  heading.textContent = entry.term;

  const pos = document.createElement('span');
  pos.className = 'entry-card-pos';
  pos.textContent = `${entry.pos} · ${sectionName(entry.section)}`;

  const gloss = document.createElement('p');
  gloss.className = 'entry-card-gloss';
  gloss.textContent = entry.gloss;

  const tags = document.createElement('div');
  tags.className = 'entry-card-tags';
  for (const reason of (entry._reasons || []).slice(0, 2)) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = reason;
    tags.append(badge);
  }

  card.append(top, heading, pos, gloss, tags);
  return card;
}

function reset() {
  input.value = '';
  clearBtn.classList.remove('visible');
  closeSuggestions();
  resultsBlock.classList.remove('active');
  resultsGrid.textContent = '';
  resultsMore.textContent = '';
  resultsSuggestion.textContent = '';
  browse.hidden = false;
}

/* ------------------------------- helpers ------------------------------- */

function sectionName(id) {
  return engine?.sections?.[id]?.title || id;
}

function scopeName() {
  return scope === 'all' ? 'both sections' : sectionName(scope);
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
