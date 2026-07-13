/* ============================================================
   media.js — Data store, rendering, filtering & form handling
   for the Media page
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
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    status: 'published',
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
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #0d0d2b 0%, #1b1464 50%, #3d1f8e 100%)',
    status: 'published',
    featured: true,
    articleUrl: '#',
  },
  {
    id: 'open-source-manifesto',
    title: 'Why Open Source Isn\'t Optional Anymore',
    author: 'Pratyush',
    date: '2026-06-28',
    category: 'Open Source',
    excerpt: 'From governments to startups, open source has become the backbone of modern software. We argue it\'s not charity — it\'s strategy.',
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #1a0a0a 0%, #2d1f1f 50%, #4a2c2c 100%)',
    status: 'published',
    featured: false,
    articleUrl: '#',
  },
  {
    id: 'browser-privacy-toolkit',
    title: 'Building a Privacy Toolkit in the Browser',
    author: 'Divyansh Tripathi',
    date: '2026-06-20',
    category: 'Privacy & Security',
    excerpt: 'Zero-knowledge proofs, client-side encryption, and local-only processing — the tools exist. Here\'s how to wire them together.',
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #0a1a0a 0%, #1f2d1f 50%, #2c4a2c 100%)',
    status: 'published',
    featured: false,
    articleUrl: '#',
  },
  {
    id: 'dev-tools-renaissance',
    title: 'The Dev Tools Renaissance',
    author: 'Pratyush',
    date: '2026-06-15',
    category: 'Dev Tools',
    excerpt: 'IDEs are getting smarter, CLIs are getting prettier, and AI copilots are everywhere. A tour of the tools shaping the next decade of development.',
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #1a1a0a 0%, #2d2d1f 50%, #4a4a2c 100%)',
    status: 'published',
    featured: false,
    articleUrl: '#',
  },
  // Upcoming articles
  {
    id: 'edge-computing-ai',
    title: 'Edge Computing × AI: The Silent Revolution',
    author: 'The Hallucinated Lab',
    date: '2026-08-01',
    category: 'AI & ML',
    excerpt: 'When inference moves to the edge, latency drops and privacy soars. A deep dive into the hardware and software making it happen.',
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1f1f2d 50%, #2c2c4a 100%)',
    status: 'upcoming',
    featured: false,
    articleUrl: null,
  },
  {
    id: 'wasm-future',
    title: 'WebAssembly: The Universal Runtime',
    author: 'The Hallucinated Lab',
    date: '2026-08-15',
    category: 'Dev Tools',
    excerpt: 'WASM is escaping the browser. From serverless functions to IoT devices, it\'s becoming the write-once-run-anywhere dream Java promised.',
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #1a0a1a 0%, #2d1f2d 50%, #4a2c4a 100%)',
    status: 'upcoming',
    featured: false,
    articleUrl: null,
  },
  {
    id: 'post-quantum-cryptography',
    title: 'Post-Quantum Cryptography for Mortals',
    author: 'The Hallucinated Lab',
    date: '2026-09-01',
    category: 'Privacy & Security',
    excerpt: 'Quantum computers will break RSA. Here\'s what replaces it — lattice-based, hash-based, and code-based schemes explained without the PhD.',
    coverImage: null,
    coverGradient: 'linear-gradient(135deg, #0a1a1a 0%, #1f2d2d 50%, #2c4a4a 100%)',
    status: 'upcoming',
    featured: false,
    articleUrl: null,
  },
];

/* ============ HELPERS ============ */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getCategoryIcon(category) {
  const icons = {
    'AI & ML': '<path d="M21 10.12h-6.78l2.74-2.82-2.2-2.2L9 10.88V21h10.12l2.06-5.78L21 10.12zM12.5 17.5h-2v-2h2v2zm0-3h-2v-4h2v4z"/>',
    'Quantum Computing': '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
    'Open Source': '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>',
    'Privacy & Security': '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
    'Dev Tools': '<path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>',
    'Research': '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>',
    'General': '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
    'Other': '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
  };
  return icons[category] || icons['General'];
}

/* ============ RENDER: FEATURED ============ */
function renderFeatured() {
  const grid = document.getElementById('featured-grid');
  if (!grid) return;

  const featured = ARTICLES.filter(a => a.featured && a.status === 'published');
  if (featured.length === 0) {
    grid.innerHTML = '<p class="empty-text">No featured articles yet.</p>';
    return;
  }

  grid.innerHTML = featured.map((article, idx) => `
    <a href="${article.articleUrl}" class="featured-card fade-in fade-in-delay-${idx + 1}" id="featured-${article.id}">
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
          <span class="featured-date">${formatDate(article.date)}</span>
        </div>
      </div>
      <div class="featured-card-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </div>
    </a>
  `).join('');
}

/* ============ RENDER: ARCHIVE ============ */
function renderArchive(filterCategory, searchQuery) {
  const grid = document.getElementById('archive-grid');
  const empty = document.getElementById('archive-empty');
  if (!grid || !empty) return;

  let published = ARTICLES.filter(a => a.status === 'published');

  if (filterCategory && filterCategory !== 'all') {
    published = published.filter(a => a.category === filterCategory);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    published = published.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.excerpt.toLowerCase().includes(q) ||
      a.author.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    );
  }

  if (published.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.style.display = '';
  empty.style.display = 'none';

  grid.innerHTML = published.map(article => `
    <a href="${article.articleUrl}" class="archive-card fade-in" id="archive-${article.id}">
      <div class="archive-card-cover" style="background: ${article.coverGradient};">
        <span class="archive-card-category">${article.category}</span>
      </div>
      <div class="archive-card-body">
        <h3 class="archive-card-title">${article.title}</h3>
        <p class="archive-card-excerpt">${article.excerpt}</p>
        <div class="archive-card-meta">
          <span>${article.author}</span>
          <span class="archive-card-dot">·</span>
          <span>${formatDate(article.date)}</span>
        </div>
      </div>
    </a>
  `).join('');

  // Re-observe new fade-in elements
  observeNewFadeIns(grid);
}

/* ============ RENDER: ARCHIVE FILTERS ============ */
function renderArchiveFilters() {
  const container = document.getElementById('archive-filters');
  if (!container) return;

  const categories = [...new Set(ARTICLES.filter(a => a.status === 'published').map(a => a.category))];

  // Keep the "All" button, add category buttons
  container.innerHTML = '<button class="filter-btn active" data-filter="all">All</button>' +
    categories.map(cat => `<button class="filter-btn" data-filter="${cat}">${cat}</button>`).join('');

  // Click handlers
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const search = document.getElementById('archive-search');
      renderArchive(btn.dataset.filter, search ? search.value : '');
    });
  });
}

/* ============ RENDER: HORIZON ============ */
function renderHorizon() {
  const grid = document.getElementById('horizon-grid');
  if (!grid) return;

  const upcoming = ARTICLES.filter(a => a.status === 'upcoming');
  if (upcoming.length === 0) {
    grid.innerHTML = '<p class="empty-text">Nothing on the horizon yet — stay tuned.</p>';
    return;
  }

  grid.innerHTML = upcoming.map((article, idx) => `
    <div class="horizon-card fade-in fade-in-delay-${(idx % 3) + 1}" id="horizon-${article.id}">
      <div class="horizon-card-cover" style="background: ${article.coverGradient};">
        <div class="horizon-badge">Coming Soon</div>
      </div>
      <div class="horizon-card-body">
        <span class="horizon-category">${article.category}</span>
        <h3 class="horizon-card-title">${article.title}</h3>
        <p class="horizon-card-excerpt">${article.excerpt}</p>
        <div class="horizon-card-meta">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
          <span>Expected ${formatDate(article.date)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ============ RENDER: COMMUNITY SPOTLIGHT ============ */
function renderCommunity() {
  const grid = document.getElementById('community-grid');
  const empty = document.getElementById('community-empty');
  if (!grid || !empty) return;

  const submissions = JSON.parse(localStorage.getItem('thl_community_posts') || '[]');

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
        <div class="community-avatar" aria-hidden="true">${post.name.charAt(0).toUpperCase()}</div>
        <div class="community-card-info">
          <span class="community-author">${escapeHtml(post.name)}</span>
          <span class="community-date">${formatDate(post.date)}</span>
        </div>
        <span class="community-category-tag">${escapeHtml(post.category)}</span>
      </div>
      <h3 class="community-card-title">${escapeHtml(post.title)}</h3>
      <p class="community-card-body">${escapeHtml(post.body).substring(0, 300)}${post.body.length > 300 ? '…' : ''}</p>
    </div>
  `).join('');

  observeNewFadeIns(grid);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

    const posts = JSON.parse(localStorage.getItem('thl_community_posts') || '[]');
    posts.push(post);
    localStorage.setItem('thl_community_posts', JSON.stringify(posts));

    // Reset form
    form.reset();

    // Show toast
    if (toast) {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 4000);
    }

    // Re-render community
    renderCommunity();

    // Scroll to community section
    const communitySection = document.getElementById('media-community');
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
      const activeFilter = document.querySelector('.filter-btn.active');
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
  renderHorizon();
  renderCommunity();
  initSubmitForm();
  initArchiveSearch();
});
