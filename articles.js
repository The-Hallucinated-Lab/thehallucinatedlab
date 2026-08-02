/* ============================================================
   articles.js — Data store, rendering, filtering & form handling
   for the Articles page (Featured / Archive / Community Spotlight).

   The Featured grid, Archive grid, and category filters are also
   pre-rendered as static markup in articles.html, so crawlers that
   do not execute JavaScript still see every article. This file
   re-renders the same output on load and then owns those grids —
   when ARTICLES changes below, update articles.html to match.
   ============================================================ */

/* ============ ARTICLE DATA STORE ============ */
const ARTICLES = [
  {
    id: 'local-first-ai',
    title: 'The Future of Local-First AI',
    author: 'Pratyush',
    date: '2026-07-10',
    category: 'AI & ML',
    excerpt: 'Why running AI models entirely on your machine isn\'t just a privacy win — it\'s the future of personal computing. We explore the shift from cloud dependency to local-first intelligence.',
    coverGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    featured: true,
    articleUrl: 'articles/sample-article.html',
  },
  {
    id: 'quantum-ml-crossroads',
    title: 'Quantum Computing Meets Machine Learning',
    author: 'Divyansh Tripathi',
    date: '2026-07-05',
    category: 'Quantum Computing',
    excerpt: 'At the intersection of qubits and gradient descent lies a new paradigm. How quantum-enhanced ML could reshape optimization, drug discovery, and cryptography.',
    coverGradient: 'linear-gradient(135deg, #0d0d2b 0%, #1b1464 50%, #3d1f8e 100%)',
    featured: true,
    articleUrl: null,
  },
  {
    id: 'open-source-manifesto',
    title: 'Why Open Source Isn\'t Optional Anymore',
    author: 'Pratyush',
    date: '2026-06-28',
    category: 'Open Source',
    excerpt: 'From governments to startups, open source has become the backbone of modern software. We argue it\'s not charity — it\'s strategy.',
    coverGradient: 'linear-gradient(135deg, #1a0a0a 0%, #2d1f1f 50%, #4a2c2c 100%)',
    featured: false,
    articleUrl: null,
  },
  {
    id: 'browser-privacy-toolkit',
    title: 'Building a Privacy Toolkit in the Browser',
    author: 'Divyansh Tripathi',
    date: '2026-06-20',
    category: 'Privacy & Security',
    excerpt: 'Zero-knowledge proofs, client-side encryption, and local-only processing — the tools exist. Here\'s how to wire them together.',
    coverGradient: 'linear-gradient(135deg, #0a1a0a 0%, #1f2d1f 50%, #2c4a2c 100%)',
    featured: false,
    articleUrl: null,
  },
  {
    id: 'dev-tools-renaissance',
    title: 'The Dev Tools Renaissance',
    author: 'Pratyush',
    date: '2026-06-15',
    category: 'Dev Tools',
    excerpt: 'IDEs are getting smarter, CLIs are getting prettier, and AI copilots are everywhere. A tour of the tools shaping the next decade of development.',
    coverGradient: 'linear-gradient(135deg, #1a1a0a 0%, #2d2d1f 50%, #4a4a2c 100%)',
    featured: false,
    articleUrl: null,
  },
];

/* ============ HELPERS ============ */
const MAX_COMMUNITY_POSTS = 50;

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* Article copy is authored in ARTICLES above rather than submitted by
   anyone, but it still goes through innerHTML — so an ampersand or a
   stray angle bracket in a title would otherwise render as broken
   markup rather than as text. */
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

/* Only ever fed the authored coverGradient values; this keeps anything
   that is not a plain CSS gradient out of the style attribute. */
function safeGradient(value) {
  return /^(linear|radial)-gradient\([^;"<>]*\)$/.test(value || '') ? value : 'var(--bg-card)';
}

/* ============ COMMUNITY POST STORAGE ============
   localStorage is synchronous and blocks the main thread, so this store
   is deliberately bounded: oldest entries are evicted past
   MAX_COMMUNITY_POSTS rather than letting the array grow for as long as
   someone keeps submitting. Reads always return an array, whatever is
   actually sitting in storage. */
const COMMUNITY_KEY = 'thl_community_posts';

function readCommunityPosts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMUNITY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(p => p && typeof p === 'object') : [];
  } catch (err) {
    return [];
  }
}

function writeCommunityPost(post) {
  try {
    const posts = readCommunityPosts();
    posts.push(post);
    localStorage.setItem(COMMUNITY_KEY, JSON.stringify(posts.slice(-MAX_COMMUNITY_POSTS)));
  } catch (err) {
    /* storage full or blocked — the post still renders this session */
  }
}

/* An article without a URL is written but not yet published — render it as
   a dead card rather than a link that goes nowhere. */
function isReadable(article) {
  return Boolean(article.articleUrl) && article.articleUrl !== '#';
}

function sortByNewest(list) {
  return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ============ RENDER: FEATURED ============ */
function renderFeatured() {
  const grid = document.getElementById('featured-grid');
  if (!grid) return;

  const featured = sortByNewest(ARTICLES.filter(a => a.featured));
  if (featured.length === 0) {
    setGridHtml(grid, '<p class="empty-text">No featured articles yet.</p>');
    return;
  }

  setGridHtml(grid, featured.map((article, idx) => {
    const readable = isReadable(article);
    const tag = readable ? 'a' : 'div';
    const href = readable ? ` href="${escapeAttr(article.articleUrl)}"` : '';

    return `
    <${tag}${href} class="featured-card${readable ? '' : ' featured-card-locked'} fade-in fade-in-delay-${(idx % 3) + 1}" id="featured-${escapeAttr(article.id)}">
      <div class="featured-card-cover" style="background: ${safeGradient(article.coverGradient)};">
        <div class="featured-badge">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          Featured
        </div>
        <div class="featured-card-overlay">
          <span class="featured-category">${escapeHtml(article.category)}</span>
        </div>
      </div>
      <div class="featured-card-body">
        <h3 class="featured-card-title">${escapeHtml(article.title)}</h3>
        <p class="featured-card-excerpt">${escapeHtml(article.excerpt)}</p>
        <div class="featured-card-meta">
          <span class="featured-author">${escapeHtml(article.author)}</span>
          <span class="featured-date">${readable ? formatDate(article.date) : 'In the works'}</span>
        </div>
      </div>
      ${readable ? `<div class="featured-card-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </div>` : ''}
    </${tag}>`;
  }).join(''));

  observeNewFadeIns(grid);
}

/* ============ RENDER: ARCHIVE ============ */
function renderArchive(filterCategory, searchQuery) {
  const grid = document.getElementById('archive-grid');
  const empty = document.getElementById('archive-empty');
  if (!grid || !empty) return;

  let list = sortByNewest(ARTICLES);

  if (filterCategory && filterCategory !== 'all') {
    list = list.filter(a => a.category === filterCategory);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.excerpt.toLowerCase().includes(q) ||
      a.author.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    );
  }

  if (list.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';

  setGridHtml(grid, list.map(article => {
    const readable = isReadable(article);
    const tag = readable ? 'a' : 'div';
    const href = readable ? ` href="${escapeAttr(article.articleUrl)}"` : '';

    return `
    <${tag}${href} class="archive-card${readable ? '' : ' archive-card-locked'} fade-in" id="archive-${escapeAttr(article.id)}">
      <div class="archive-card-cover" style="background: ${safeGradient(article.coverGradient)};">
        <span class="archive-card-category">${escapeHtml(article.category)}</span>
        ${readable ? '' : '<span class="archive-card-soon">Draft</span>'}
      </div>
      <div class="archive-card-body">
        <h3 class="archive-card-title">${escapeHtml(article.title)}</h3>
        <p class="archive-card-excerpt">${escapeHtml(article.excerpt)}</p>
        <div class="archive-card-meta">
          <span>${escapeHtml(article.author)}</span>
          <span class="archive-card-dot">·</span>
          <span>${readable ? formatDate(article.date) : 'Not published yet'}</span>
        </div>
      </div>
    </${tag}>`;
  }).join(''));

  observeNewFadeIns(grid);
}

/* ============ RENDER: ARCHIVE FILTERS ============ */
function renderArchiveFilters() {
  const container = document.getElementById('archive-filters');
  if (!container) return;

  const categories = [...new Set(ARTICLES.map(a => a.category))];

  container.innerHTML = '<button class="filter-btn active" data-filter="all" type="button">All</button>' +
    categories.map(cat => `<button class="filter-btn" data-filter="${escapeAttr(cat)}" type="button">${escapeHtml(cat)}</button>`).join('');

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const search = document.getElementById('archive-search');
      renderArchive(btn.dataset.filter, search ? search.value : '');
    });
  });
}

/* ============ RENDER: COMMUNITY SPOTLIGHT ============ */
function renderCommunity() {
  const grid = document.getElementById('community-grid');
  const empty = document.getElementById('community-empty');
  if (!grid || !empty) return;

  const submissions = readCommunityPosts();

  if (submissions.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';

  // Show newest first
  const sorted = [...submissions].reverse();

  setGridHtml(grid, sorted.map((post, idx) => {
    const name = String(post.name || 'Anonymous');
    const body = String(post.body || '');
    return `
    <div class="community-card fade-in" id="community-post-${idx}">
      <div class="community-card-header">
        <div class="community-avatar" aria-hidden="true">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div class="community-card-info">
          <span class="community-author">${escapeHtml(name)}</span>
          <span class="community-date">${formatDate(post.date)}</span>
        </div>
        <span class="community-category-tag">${escapeHtml(post.category)}</span>
      </div>
      <h3 class="community-card-title">${escapeHtml(post.title)}</h3>
      <p class="community-card-body">${escapeHtml(body.substring(0, 300))}${body.length > 300 ? '…' : ''}</p>
    </div>`;
  }).join(''));

  observeNewFadeIns(grid);
}

/* ============ FORM HANDLING ============ */
function initSubmitForm() {
  const form = document.getElementById('submit-form');
  const toast = document.getElementById('submit-toast');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('submit-name').value.trim();
    const email = document.getElementById('submit-email').value.trim();
    const title = document.getElementById('submit-title').value.trim();
    const category = document.getElementById('submit-category').value;
    const body = document.getElementById('submit-body').value.trim();

    if (!name || !title || !body) return;

    const post = {
      name,
      email,
      title,
      category,
      body,
      date: new Date().toISOString().split('T')[0],
    };

    writeCommunityPost(post);

    form.reset();

    if (toast) {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    }

    renderCommunity();

    const communitySection = document.getElementById('articles-community');
    if (communitySection) {
      setTimeout(() => {
        communitySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    }
  });
}

/* ============ SEARCH ============ */
function initArchiveSearch() {
  const search = document.getElementById('archive-search');
  if (!search) return;

  let debounceTimer;
  search.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const activeFilter = document.querySelector('#archive-filters .filter-btn.active');
      renderArchive(activeFilter ? activeFilter.dataset.filter : 'all', search.value);
    }, 250);
  });
}

/* ============ OBSERVE NEW FADE-INS ============
   One observer for the whole page, not one per render. The archive
   re-renders on every filter click and every debounced keystroke; the
   previous version built a fresh IntersectionObserver each time and
   never disconnected it, so each render left behind an observer still
   holding strong references to the card elements innerHTML had just
   thrown away — a detached DOM tree per search keystroke.

   Targets are unobserved as soon as they reveal, and the cards a
   container is about to discard are unobserved before it re-renders. */
const fadeObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    obs.unobserve(entry.target);
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

/* Replace a container's contents without stranding the old cards
   inside the observer. */
function setGridHtml(container, html) {
  container.querySelectorAll('.fade-in').forEach(el => fadeObserver.unobserve(el));
  container.innerHTML = html;
}

function observeNewFadeIns(container) {
  container.querySelectorAll('.fade-in:not(.visible)').forEach(el => fadeObserver.observe(el));
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  renderFeatured();
  renderArchiveFilters();
  renderArchive('all', '');
  renderCommunity();
  initSubmitForm();
  initArchiveSearch();
});
