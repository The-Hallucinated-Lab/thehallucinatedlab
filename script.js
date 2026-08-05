/* ============ CONFIG ============ */
const CONFIG = {
  particles: {
    color: [201, 168, 76],      // RGB gold
    maxCount: 80,
    densityFactor: 15000,
    connectionDistance: 150,
    connectionOpacity: 0.06,
    sizeRange: [0.5, 2.0],
    speedRange: 0.3,
    opacityRange: [0.1, 0.5],
  },
  typing: {
    texts: [
      'No cloud lock-ins.',
      'No paywalls. No ceilings.',
      'Your data stays yours.',
      'Fully local AI pipelines.',
      'Open source. Always.',
    ],
    typeSpeed: 80,
    deleteSpeed: 40,
    pauseAfterType: 2000,
    pauseAfterDelete: 500,
  },
  navbar: {
    scrollThreshold: 50,
    sectionOffset: 100,
  },
};

/* ============ DEVICE / CONNECTION BUDGET ============
   The hero canvas and the typing loop are decoration. On a metered
   connection, a low-memory phone, or for someone who has asked the OS
   for less motion, they are pure cost — so we decide once, up front,
   how much of it to run. */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function shouldAnimate() {
  if (prefersReducedMotion.matches) return false;
  const conn = navigator.connection;
  if (conn) {
    if (conn.saveData) return false;
    if (/(^|-)2g$/.test(conn.effectiveType || '')) return false;
  }
  if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2) return false;
  return true;
}

/* ============ PARTICLES ============ */
function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;

  // Nothing below this point should run at all if we're not animating.
  if (!shouldAnimate()) {
    canvas.remove();
    return;
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const particles = [];
  const { color, maxCount, densityFactor, connectionDistance, connectionOpacity, sizeRange, speedRange, opacityRange } = CONFIG.particles;
  const connectionDistanceSq = connectionDistance * connectionDistance;
  const rgb = `${color[0]}, ${color[1]}, ${color[2]}`;

  let width = 0;
  let height = 0;
  let rafId = null;
  let onScreen = true;

  /* A full-viewport canvas at devicePixelRatio 3 costs ~4x the backing
     store of one at DPR 1.5 for a field of soft dots nobody inspects. */
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === width && h === height) return;   // orientation-bar jitter fires resize with no real change
    width = w;
    height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  };
  window.addEventListener('resize', onResize, { passive: true });

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.size = Math.random() * (sizeRange[1] - sizeRange[0]) + sizeRange[0];
      this.speedX = (Math.random() - 0.5) * speedRange;
      this.speedY = (Math.random() - 0.5) * speedRange;
      this.opacity = Math.random() * (opacityRange[1] - opacityRange[0]) + opacityRange[0];
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > width || this.y < 0 || this.y > height) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${this.opacity})`;
      ctx.fill();
    }
  }

  const count = Math.min(maxCount, Math.floor(width * height / densityFactor));
  for (let i = 0; i < count; i++) particles.push(new Particle());

  function connectParticles() {
    /* O(n^2) over the particle field every frame. Comparing squared
       distances keeps the ~3,000 Math.sqrt calls per frame out of it —
       the threshold comparison is identical either way. */
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < connectionDistanceSq) {
          const dist = Math.sqrt(distSq);
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${rgb}, ${connectionOpacity * (1 - dist / connectionDistance)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) { p.update(); p.draw(); }
    connectParticles();
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }
  function stop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  /* Stop the loop outright once the hero scrolls away, and whenever the
     tab is backgrounded — a canvas nobody can see should not be burning
     frames or battery. */
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen && document.visibilityState === 'visible') start(); else stop();
  }, { threshold: 0 });
  visibilityObserver.observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && onScreen) start(); else stop();
  });

  /* If motion preference flips mid-session, honour it without a reload. */
  prefersReducedMotion.addEventListener('change', (e) => {
    if (e.matches) { stop(); visibilityObserver.disconnect(); canvas.remove(); }
  });

  start();
}

/* ============ NAVBAR ============ */
/* ============ DEV / LIVE MODE ============
   Two ideas, kept separate on purpose:

   1. Dev content is hidden by CSS by default and revealed by
      data-mode="dev" on <html>. Nothing here can leak unfinished work,
      because JS only ever adds visibility, never removes it.

   2. Ctrl+Alt+\ toggles it. That is the entire gate.

   What this is NOT, and never was: a security boundary. The site is
   static, so the dev markup ships to every visitor and anyone reading
   the source can find it. The shortcut stops accidental discovery, not
   a determined reader - don't put anything behind it you would mind
   being read.

   This replaced a per-device founder key (SHA-256 of 32 random bytes,
   enrolled from the console, hashes committed here). That was a lot of
   machinery to guard something that was never a boundary, and it needed
   crypto.subtle, so it silently never opened on file://. A shortcut has
   none of those failure modes. */
const MODE_KEY = 'thl_mode';
/* Survives the reload below so the toast can be shown afterwards. */
const FLASH_KEY = 'thl_mode_flash';

/* @pure-start
   Storage access is kept out of here so the decisions themselves can be
   tested under node. Anything unrecognised resolves to 'live': the
   failure that matters is showing unfinished work to a visitor, so every
   ambiguous input has to land on the public view. */
function normalizeMode(raw) {
  return raw === 'dev' ? 'dev' : 'live';
}

/* An entry with no status is live. Dev entries need dev mode. */
function navEntryVisible(item, mode) {
  return !item || item.status !== 'dev' || mode === 'dev';
}

function otherMode(mode) {
  return normalizeMode(mode) === 'dev' ? 'live' : 'dev';
}

/* Ctrl+Alt+\ and nothing else. Modifiers are checked exhaustively so
   the shortcut cannot fire as a subset of a larger chord a browser or
   an OS already owns.

   event.code, not event.key: code is the physical key, and on several
   keyboard layouts Alt+backslash produces an entirely different
   character. Matching on key would work on one machine and quietly not
   on another. */
function isModeToggle(event) {
  return !!event &&
    event.ctrlKey === true &&
    event.altKey === true &&
    event.shiftKey !== true &&
    event.metaKey !== true &&
    event.code === 'Backslash';
}
/* @pure-end */

function readMode() {
  try {
    return normalizeMode(localStorage.getItem(MODE_KEY));
  } catch (e) {
    return 'live';   // private mode, storage disabled - fail to the public view
  }
}

function applyMode(mode) {
  document.documentElement.setAttribute('data-mode', mode);
}

/* Without this the toggle is invisible on any page that happens to have
   no dev content, and you cannot tell whether it fired. */
function flashMode(mode) {
  let toast = document.querySelector('.mode-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'mode-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = mode === 'dev' ? 'Dev mode' : 'Live mode';
  toast.classList.toggle('is-dev', mode === 'dev');
  toast.classList.add('is-on');
  clearTimeout(flashMode.timer);
  flashMode.timer = setTimeout(() => toast.classList.remove('is-on'), 1400);
}

function toggleMode() {
  const next = otherMode(readMode());
  try {
    localStorage.setItem(MODE_KEY, next);
    sessionStorage.setItem(FLASH_KEY, next);
  } catch (e) { /* storage off - the reload below still applies nothing */ }

  /* Reload rather than repaint. The CSS reveal is instant on its own,
     but the nav flyout filters its subsections when it is built, so an
     in-place toggle would leave the bar disagreeing with the page it is
     sitting on. One reload keeps every surface consistent, and is a far
     smaller thing to own than a teardown path that exists only for a
     shortcut nobody presses twice in a row. */
  location.reload();
}

function initDevMode() {
  applyMode(readMode());

  /* Shown after the reload, not before it. Without this the toggle is
     invisible on any page that happens to carry no dev content, and
     "did that work?" has no answer. */
  try {
    if (sessionStorage.getItem(FLASH_KEY)) {
      sessionStorage.removeItem(FLASH_KEY);
      flashMode(readMode());
    }
  } catch (e) { /* storage off */ }

  document.addEventListener('keydown', (event) => {
    if (!isModeToggle(event)) return;
    event.preventDefault();
    toggleMode();
  });
}


/* ============ NAV SUBSECTIONS ============
   Keyed by the href already in the markup, so the nav stays declarative in
   HTML and this only enhances it. A page with no entry simply never
   expands, which is why Home, Certification and Consultancy are absent
   rather than listed with empty arrays. */
const NAV_CHILDREN = {
  'tools.html': [
    { label: 'THL Library', href: 'library.html' },
    { label: 'Assistant', href: 'interface.html' },
    { label: 'Prompts', href: 'prompts.html' },
    { label: 'Adapters', href: 'adapters.html', status: 'dev' },
  ],
  'media.html': [
    { label: 'Blogs', href: 'blogs.html' },
    { label: 'Artifacts', href: 'artifacts.html' },
  ],
};

/* Nav entries carry their own status. This list stays here rather than in
   spec/manifest.json for one reason: the nav must render synchronously.
   The manifest arrives over fetch, and waiting on it would make the bar
   pop in after paint on every page. The manifest owns tool status; this
   owns section status. */
const navVisible = item => navEntryVisible(item, readMode());

/* 20px stroke glyphs, drawn on the 24-grid the rest of the site uses. */
const NAV_ICONS = {
  '/': 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  'tools.html': 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.1-.5-.5-2.1z',
  'interface.html': 'M12 3.5l1.7 4.8L18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z',
  'solutions.html': 'M12 3l9 5-9 5-9-5zM3 12.5 12 17l9-4.5M3 17 12 21l9-4',
  'media.html': 'M12 6.5a4 4 0 0 0-4-2H3v13h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v-13h-5a4 4 0 0 0-4 2zM12 6.5v13',
  'certification.html': 'M12 3l2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 14.8l-4.6 2.4.9-5.1L4.5 8.5l5.2-.8z',
  'consultancy.html': 'M16 20v-1a4 4 0 0 0-8 0v1M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
};

/* Collapse each top-level link to its icon and reveal the label on hover,
   then expand its subsections inline to the right of whatever was clicked.
   Progressive enhancement on purpose: the <ul> stays in the HTML, so with
   JS off (or for a crawler) it is still a plain list of working links. */
function initNavFlyout() {
  const list = document.querySelector('.nav-links');
  if (!list || !window.matchMedia('(min-width: 769px)').matches) return;

  /* Scoping class: the icon styling must not apply to the plain text list
     that mobile and no-JS get. CSS keys off .nav-links.is-icons, so the
     enhanced and unenhanced states can never bleed into each other. */
  list.classList.add('is-icons');

  const key = a => (a.getAttribute('href') || '').replace(/^\.\//, '');
  let openItem = null;

  const collapse = () => {
    if (!openItem) return;
    openItem.querySelector('.nav-flyout').style.width = '0px';
    openItem.classList.remove('is-open');
    openItem = null;
  };

  list.querySelectorAll(':scope > li').forEach((li) => {
    const link = li.querySelector('a');
    if (!link) return;
    const href = key(link);

    const icon = NAV_ICONS[href];
    if (icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', icon);
      svg.appendChild(path);
      /* Keep the text node — it is the accessible name and the crawlable
         label. CSS clips it to zero width until hover. */
      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = link.textContent.trim();
      link.textContent = '';
      link.append(svg, label);
      link.classList.add('has-icon');
    }

    const children = (NAV_CHILDREN[href] || []).filter(navVisible);
    if (!children.length) return;

    li.classList.add('has-children');
    const fly = document.createElement('span');
    fly.className = 'nav-flyout';
    const inner = document.createElement('span');
    inner.className = 'nav-flyout-inner';
    const rule = document.createElement('span');
    rule.className = 'nav-flyout-rule';
    inner.appendChild(rule);
    children.forEach((c) => {
      const a = document.createElement('a');
      a.className = 'nav-sub';
      a.href = c.href;
      a.textContent = c.label;
      inner.appendChild(a);
    });
    fly.appendChild(inner);
    li.appendChild(fly);

    link.addEventListener('click', (e) => {
      /* First click opens, second follows through. The section page is
         still reachable, but one click reveals what is inside it. */
      if (openItem === li) return;
      e.preventDefault();
      collapse();
      openItem = li;
      li.classList.add('is-open');
      fly.style.width = inner.scrollWidth + 'px';
    });
  });

  document.addEventListener('click', (e) => {
    if (openItem && !openItem.contains(e.target)) collapse();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') collapse();
  });
}

function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const hamburger = document.querySelector('.nav-hamburger');
  const navLinks = document.querySelector('.nav-links');
  const links = document.querySelectorAll('.nav-links a');

  if (!navbar) return;

  initNavFlyout();

  /* Scroll-aware background. Passive so it never blocks scrolling, and
     the class write is deferred to a frame so a fast flick does not
     queue one style recalculation per scroll event. */
  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      navbar.classList.toggle('scrolled', window.scrollY > CONFIG.navbar.scrollThreshold);
      scrollQueued = false;
    });
  }, { passive: true });

  // Hamburger toggle with ARIA
  if (hamburger && navLinks) {
    const closeMenu = () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
    };

    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });

    links.forEach(link => link.addEventListener('click', closeMenu));

    // Close menu on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        closeMenu();
        hamburger.focus();
      }
    });
  }

  // Active section highlighting via IntersectionObserver
  const sections = document.querySelectorAll('section[id]');
  if (!sections.length) return;

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const link = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      if (!link) return;
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  }, { threshold: 0.3, rootMargin: '-10% 0px -60% 0px' });

  sections.forEach(sec => sectionObserver.observe(sec));
}

/* ============ SCROLL ANIMATIONS ============ */
function initScrollAnimations() {
  const targets = document.querySelectorAll('.fade-in');
  if (!targets.length) return;

  /* Reveal is one-way, so each element is unobserved the moment it
     fires. Once the last one has, the observer holds no element
     references at all and can be collected. */
  let remaining = targets.length;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      obs.unobserve(entry.target);
      if (--remaining === 0) obs.disconnect();
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  targets.forEach(el => observer.observe(el));
}

/* ============ TYPING EFFECT ============ */
function initTypingEffect() {
  const el = document.getElementById('typing-text');
  if (!el) return;

  const { texts, typeSpeed, deleteSpeed, pauseAfterType, pauseAfterDelete } = CONFIG.typing;

  const srOnly = document.createElement('span');
  srOnly.className = 'sr-only';
  srOnly.setAttribute('aria-live', 'polite');
  srOnly.setAttribute('aria-atomic', 'true');
  el.parentNode.appendChild(srOnly);
  el.removeAttribute('aria-live');
  el.removeAttribute('aria-atomic');

  /* Reduced motion still wants the content, just not the animation:
     show the first line, announce it, and leave it alone. */
  if (!shouldAnimate()) {
    el.textContent = texts[0];
    srOnly.textContent = texts[0];
    return;
  }

  let textIdx = 0;
  let charIdx = 0;
  let deleting = false;
  let timer = null;

  function type() {
    const current = texts[textIdx];
    el.textContent = current.substring(0, charIdx);

    if (!deleting && charIdx < current.length) {
      charIdx++;
      timer = setTimeout(type, typeSpeed);
    } else if (!deleting && charIdx === current.length) {
      srOnly.textContent = current;
      timer = setTimeout(() => { deleting = true; type(); }, pauseAfterType);
    } else if (deleting && charIdx > 0) {
      charIdx--;
      timer = setTimeout(type, deleteSpeed);
    } else {
      deleting = false;
      textIdx = (textIdx + 1) % texts.length;
      timer = setTimeout(type, pauseAfterDelete);
    }
  }

  /* A backgrounded tab does not need a timer waking it up every 40ms. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      timer = null;
    } else if (timer === null) {
      type();
    }
  });

  type();
}

/* ============ INIT ============
   These four run on every page of the site and are independent of each
   other, but they used to run as one uninterrupted sequence — so a
   throw inside initParticles (a canvas the page can live without) took
   initNavbar with it, and the mobile menu, the Escape-to-close handler
   and the section highlighting never got wired up. Losing decoration
   should not cost anyone navigation.

   Each feature is isolated, and its name is reported if it fails so the
   console says which one rather than just pointing at this file. */
function startFeature(name, init) {
  try {
    init();
  } catch (err) {
    console.error(`[init] ${name} failed:`, err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  /* First: it decides what the rest of the page is allowed to show. */
  startFeature('dev-mode', initDevMode);
  startFeature('particles', initParticles);
  startFeature('navbar', initNavbar);
  startFeature('scroll-animations', initScrollAnimations);
  startFeature('typing', initTypingEffect);
});

/* A rejected promise with no handler is otherwise invisible outside
   devtools. Nothing here reports anywhere — the site has no telemetry
   and collects nothing — but naming it in the console is the difference
   between a diagnosable bug report and "it just stopped working". */
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled rejection]', event.reason);
});
