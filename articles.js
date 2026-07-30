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
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
    grid.innerHTML = '<p class="empty-text">No featured articles yet.</p>';
    return;
  }

  grid.innerHTML = featured.map((article, idx) => {
    const readable = isReadable(article);
    const tag = readable ? 'a' : 'div';
    const href = readable ? ` href="${article.articleUrl}"` : '';

    return `
    <${tag}${href} class="featured-card${readable ? '' : ' featured-card-locked'} fade-in fade-in-delay-${(idx % 3) + 1}" id="featured-${article.id}">
      <div class="featured-card-cover" style="background: ${article.coverGradient};">
        <div class="featured-badge">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          Featured
        </div>
        <div class="featured-card-overlay">
          <span class="featured-category">${article.category}</span>
        </div>
      </div>
      <div class="featured-card-body">
        <h3 class="featured-card-title">${article.title}</h3>
        <p class="featured-card-excerpt">${article.excerpt}</p>
        <div class="featured-card-meta">
          <span class="featured-author">${article.author}</span>
          <span class="featured-date">${readable ? formatDate(article.date) : 'In the works'}</span>
        </div>
      </div>
      ${readable ? `<div class="featured-card-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </div>` : ''}
    </${tag}>`;
  }).join('');

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

  grid.innerHTML = list.map(article => {
    const readable = isReadable(article);
    const tag = readable ? 'a' : 'div';
    const href = readable ? ` href="${article.articleUrl}"` : '';

    return `
    <${tag}${href} class="archive-card${readable ? '' : ' archive-card-locked'} fade-in" id="archive-${article.id}">
      <div class="archive-card-cover" style="background: ${article.coverGradient};">
        <span class="archive-card-category">${article.category}</span>
        ${readable ? '' : '<span class="archive-card-soon">Draft</span>'}
      </div>
      <div class="archive-card-body">
        <h3 class="archive-card-title">${article.title}</h3>
        <p class="archive-card-excerpt">${article.excerpt}</p>
        <div class="archive-card-meta">
          <span>${article.author}</span>
          <span class="archive-card-dot">·</span>
          <span>${readable ? formatDate(article.date) : 'Not published yet'}</span>
        </div>
      </div>
    </${tag}>`;
  }).join('');

  observeNewFadeIns(grid);
}

/* ============ RENDER: ARCHIVE FILTERS ============ */
function renderArchiveFilters() {
  const container = document.getElementById('archive-filters');
  if (!container) return;

  const categories = [...new Set(ARTICLES.map(a => a.category))];

  container.innerHTML = '<button class="filter-btn active" data-filter="all" type="button">All</button>' +
    categories.map(cat => `<button class="filter-btn" data-filter="${cat}" type="button">${cat}</button>`).join('');

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

  let submissions = [];
  try {
    submissions = JSON.parse(localStorage.getItem('thl_community_posts') || '[]');
  } catch (err) {
    submissions = [];
  }

  if (submissions.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';

  // Show newest first
  const sorted = [...submissions].reverse();

  grid.innerHTML = sorted.map((post, idx) => `
    <div class="community-card fade-in" id="community-post-${idx}">
      <div class="community-card-header">
        <div class="community-avatar" aria-hidden="true">${escapeHtml(post.name.charAt(0).toUpperCase())}</div>
        <div class="community-card-info">
          <span class="community-author">${escapeHtml(post.name)}</span>
          <span class="community-date">${formatDate(post.date)}</span>
        </div>
        <span class="community-category-tag">${escapeHtml(post.category)}</span>
      </div>
      <h3 class="community-card-title">${escapeHtml(post.title)}</h3>
      <p class="community-card-body">${escapeHtml(post.body.substring(0, 300))}${post.body.length > 300 ? '…' : ''}</p>
    </div>
  `).join('');

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

    try {
      const posts = JSON.parse(localStorage.getItem('thl_community_posts') || '[]');
      posts.push(post);
      localStorage.setItem('thl_community_posts', JSON.stringify(posts));
    } catch (err) {
      /* storage full or blocked — the post still renders this session */
    }

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

/* ============ OBSERVE NEW FADE-INS ============ */
function observeNewFadeIns(container) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  container.querySelectorAll('.fade-in:not(.visible)').forEach(el => observer.observe(el));
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
