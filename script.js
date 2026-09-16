/* ============ CONFIG ============ */
const CONFIG = {
  particles: {
    color: [201, 168, 76],      // RGB gold, on the dark page
    /* The light page is sand, and gold on sand measures under 1.3:1 —
       the field simply disappears. The canvas is decoration, so this is
       cosmetic rather than an a11y failure, but an empty hero is not
       what the light theme is meant to look like. */
    colorLight: [107, 84, 16],
    maxCount: 80,
    densityFactor: 15000,
    connectionDistance: 150,
    connectionOpacity: 0.06,
    /* The connecting lines are drawn at a fixed alpha, so on the lighter
       page they need a little more of it to survive the same blur. */
    connectionOpacityLight: 0.10,
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
  const { color, colorLight, maxCount, densityFactor, connectionDistance, connectionOpacity, connectionOpacityLight, sizeRange, speedRange, opacityRange } = CONFIG.particles;
  const connectionDistanceSq = connectionDistance * connectionDistance;

  /* Read from the attribute rather than taken once at startup: the theme
     toggle swaps themes live, without a reload, and a canvas still
     painting the other page's gold is the one thing on the page that
     would not follow. theme.js sets the attribute before first paint, so
     this is already correct on the first frame. */
  let rgb = '';
  let lineOpacity = connectionOpacity;
  function readTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const c = isLight ? colorLight : color;
    rgb = `${c[0]}, ${c[1]}, ${c[2]}`;
    lineOpacity = isLight ? connectionOpacityLight : connectionOpacity;
  }
  readTheme();
  new MutationObserver(readTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

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
          ctx.strokeStyle = `rgba(${rgb}, ${lineOpacity * (1 - dist / connectionDistance)})`;
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

   2. Ctrl+Alt+\ toggles it, and on a touch screen three taps on the
      footer line do the same thing. Two gestures, one per input
      device, and no third way in. That is the entire gate.

   What this is NOT, and never was: a security boundary. The site is
   static, so the dev markup ships to every visitor and anyone reading
   the source can find it. The gestures stop accidental discovery, not
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

/* Three taps, each within 600ms of the one before. Long enough to be
   comfortable on a phone held one-handed — and the first number was
   500, which is fine for a tap you have aimed and tight for one you
   are still aiming. Short enough that three taps spread over a scroll
   are not a sequence. */
const TAP_COUNT = 3;
const TAP_WINDOW_MS = 600;

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

/* The touch half of the same toggle: three taps on the footer line.
   Ctrl+Alt+\ does not exist on a phone, and a phone is where dev mode
   earns its keep — an unfinished layout looks worst on the narrowest
   screen, which is the one with no keyboard to check it from.

   Touch only, and that restriction is the entire safety argument. On a
   desktop a triple click is how you select a paragraph. A version of
   this gesture that accepted a mouse would drop a visitor into dev mode
   for doing the most ordinary thing there is to do to a line of text,
   which is precisely the failure the rest of this section is built to
   avoid. Nothing is lost by ignoring the mouse: anything with one has
   the chord already. */
function isDevTap(event) {
  return !!event && event.pointerType === 'touch';
}

/* A gap wider than the window restarts the count at 1 rather than
   throwing the tap away. Someone who taps, hesitates, then taps three
   times deliberately gets what they asked for; discarding the tap would
   leave a dead period the gesture has no way to explain. */
function nextTapCount(count, lastTapAt, now, windowMs) {
  if (!lastTapAt || now - lastTapAt > windowMs) return 1;
  return count + 1;
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

  initDevTapToggle();
}

/* The tap gesture is bound to one element rather than the document so
   that a triple tap anywhere on a page — on a card, in a code block,
   while zooming — cannot reach it. */
function initDevTapToggle() {
  /* The footer element, not its paragraph. Same idea as tapping a build
     number in an about screen — the dullest thing on the page, at the
     end of it — but the paragraph is a strip about twenty pixels tall,
     and three rapid taps that all have to land inside it is a game, not
     a gesture. One tap catching the padding instead of the text was
     enough to lose the sequence. The footer box includes that padding,
     so the whole strip is live.

     Everything the tap has to survive on iOS is handled in CSS, on this
     same element — see the touch-action rule in styles.css. */
  const target = document.querySelector('footer');
  if (!target) return;

  let count = 0;
  let lastTapAt = 0;
  let timer = null;

  target.addEventListener('pointerdown', (event) => {
    if (!isDevTap(event)) return;

    /* event.timeStamp, not Date.now(): it is monotonic from page load,
       so a clock change mid-gesture cannot stretch or collapse the
       window. Both readings have to come from the same source. */
    count = nextTapCount(count, lastTapAt, event.timeStamp, TAP_WINDOW_MS);
    lastTapAt = event.timeStamp;

    /* Replaced on every tap and cleared when one fires: a timer left
       running would reset the count in the middle of the next gesture. */
    clearTimeout(timer);
    if (count >= TAP_COUNT) {
      count = 0;
      lastTapAt = 0;
      toggleMode();
      return;
    }
    timer = setTimeout(() => { count = 0; lastTapAt = 0; }, TAP_WINDOW_MS);
  });
}


/* ============ NAV SUBSECTIONS ============
   Keyed by the href already in the markup, so the nav stays declarative in
   HTML and this only enhances it. A page with no entry simply never
   expands, which is why Home is absent
   rather than listed with empty arrays. */
/* Empty on purpose, and kept rather than deleted: the flyout machinery
   below still works, and a future section with genuinely hidden depth
   can switch it back on by adding one line here.

   Nothing nests today. Tools, Pipelines and Media are each a flat grid
   of cards, so an expanding subsection in the bar was a second, smaller
   copy of the page you were one click from anyway -- and the smaller
   copy was the one you had to discover by hovering. The page is the
   menu. */
const NAV_CHILDREN = {};

/* Nav entries carry their own status. This list stays here rather than in
   spec/manifest.json for one reason: the nav must render synchronously.
   The manifest arrives over fetch, and waiting on it would make the bar
   pop in after paint on every page. The manifest owns tool status; this
   owns section status. */
const navVisible = item => navEntryVisible(item, readMode());

/* 20px line glyphs on the 24-grid: 1.8px stroke, round caps and joins,
   drawn in the same hand as the lotus. They are stroked, not filled, so
   initNavFlyout sets fill="none" on the <svg> and the CSS strokes
   currentColor — which is what lets the active one turn saffron with a
   colour change rather than a second path. Keep every subpath open or
   closed on purpose; nothing here relies on fill. */
/* Hoisted out of the table because several keys share them — see below. */
const MEDIA_GLYPH = 'M4 5.5h16v13H4zM8 5.5v13M16 5.5v13M4 10h4M4 14h4M16 10h4M16 14h4';
const DICTIONARY_GLYPH = 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16M8.5 7.5h6';

const NAV_ICONS = {
  '/': 'M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H14v-6h-4v6H4.5a.5.5 0 0 1-.5-.5z',
  'tools.html': 'M20.5 6.8l-3.2 3.2-3.3-3.3 3.2-3.2a5 5 0 0 0-6.5 6.5L4 16.7 7.3 20l6.7-6.7a5 5 0 0 0 6.5-6.5z',
  'pipelines.html': 'M3 12h5.5M15.5 12H21M9 8l4 4-4 4M15.5 8l4 4-4 4',
  'interface.html': 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4zM8 9h8M8 12.5h5',
  'solutions.html': 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12L4 7.5M12 12v9',
  'media.html': MEDIA_GLYPH,
  'artifacts.html': MEDIA_GLYPH,
  'blogs.html': MEDIA_GLYPH,
  'dictionary/index.html': DICTIONARY_GLYPH,
  'index.html': DICTIONARY_GLYPH,
  'sitemap.html': 'M9 3.5h6v5H9zM3 15.5h6v5H3zM9 15.5h6v5H9zM15 15.5h6v5h-6zM12 8.5v3.5M6 15.5V12h12v3.5M12 12v3.5',
  'slm.html': 'M8 8h8v8H8zM5 10h3M5 14h3M16 10h3M16 14h3M10 5v3M14 5v3M10 16v3M14 16v3',
  'certification.html': 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM8.8 12.2L7.5 21l4.5-2.6 4.5 2.6-1.3-8.8',
  'consultancy.html': 'M4 8h16v11H4zM9 8V5.5h6V8M4 13h16M12 12v2',
  'data.html': 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
};

/* Collapse each top-level link to its icon and reveal the label on hover,
   then expand its subsections inline to the right of whatever was clicked.
   Progressive enhancement on purpose: the <ul> stays in the HTML, so with
   JS off (or for a crawler) it is still a plain list of working links. */
function initNavFlyout() {
  const list = document.querySelector('.nav-links');
  /* 1025px, not 769px: the CSS turns .nav-links into the full-screen
     hamburger overlay everywhere up to 1024px. Enhancing at 769px meant
     that between 769 and 1024 the overlay opened with .is-icons applied,
     which clips every label to max-width:0 — the menu rendered as a
     column of bare glyphs with no text. Enhance only where the inline
     bar is actually the nav. */
  if (!list || !window.matchMedia('(min-width: 1025px)').matches) return;

  /* Scoping class: the icon styling must not apply to the plain text list
     that mobile and no-JS get. CSS keys off .nav-links.is-icons, so the
     enhanced and unenhanced states can never bleed into each other. */
  list.classList.add('is-icons');

  /* The same page is reached by a different href from every depth: Tools
     is "tools.html" from the root, "../tools.html" from /blogs, and the
     Dictionary hub is "dictionary/index.html", "index.html" or
     "../index.html" depending on where you are standing. Matching the
     raw attribute meant an entry only got its glyph on the pages that
     happened to spell it the way NAV_ICONS did — which is why Sitemap
     rendered as a bare word inside /blogs, and why Dictionary rendered
     as one everywhere. Flatten to a root-relative path first. */
  const key = a => (a.getAttribute('href') || '')
    .replace(/^\.\//, '')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/^\//, '')
    || '/';
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
      svg.setAttribute('fill', 'none');
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

/* ============ THEME TOGGLE ============
   theme.js has already chosen the theme and painted with it before this
   file runs. All that is left is the button.

   The accessible name has to say where the click goes, not where you
   are. A button labelled "dark theme" while the page is dark tells a
   screen reader user the opposite of what pressing it does, and the
   icon — which is the same information for everyone else — already
   shows the destination.

   The system listener is deliberately narrow. Following the OS is only
   right while the visitor has not chosen for themselves; once they have,
   an OS change flipping the site out from under them is a bug. It writes
   the attribute directly rather than going through set(), so watching
   the system never quietly becomes a stored preference. */
function initThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const theme = window.THLTheme;
  if (!button || !theme) return;

  function relabel() {
    const destination = theme.get() === 'light' ? 'dark' : 'light';
    const text = `Switch to ${destination} theme`;
    button.setAttribute('aria-label', text);
    button.setAttribute('title', text);
  }
  relabel();

  button.addEventListener('click', () => {
    theme.set(theme.get() === 'light' ? 'dark' : 'light');
    relabel();
  });

  if (!window.matchMedia) return;
  const query = window.matchMedia('(prefers-color-scheme: light)');
  const follow = (event) => {
    if (!theme.isFollowingSystem()) return;
    document.documentElement.setAttribute('data-theme', event.matches ? 'light' : 'dark');
    relabel();
  };
  // Safari below 14 only has the deprecated addListener.
  if (query.addEventListener) query.addEventListener('change', follow);
  else if (query.addListener) query.addListener(follow);
}

function startFeature(name, init) {
  try {
    init();
  } catch (err) {
    console.error(`[init] ${name} failed:`, err);
  }
}

/* The lotus assembles from its convergence point once per session — on
   the first page, not every page, and never for readers who asked for
   less motion. sessionStorage is the right memory: it forgets when the
   tab closes, so a return visit gets the choreography again. */
function initLotusAssembly() {
  if (!shouldAnimate()) return;
  const KEY = 'thl_lotus_seen';
  let seen = false;
  try {
    seen = sessionStorage.getItem(KEY) === '1';
    sessionStorage.setItem(KEY, '1');
  } catch (err) {
    // Storage can be denied (private mode, quota). Then it animates once
    // per page, which is the harmless direction to fail in.
    seen = false;
  }
  if (seen) return;
  document.querySelectorAll('.nav-logo .lotus').forEach((el) => el.classList.add('is-assembling'));
}

document.addEventListener('DOMContentLoaded', () => {
  /* First: it decides what the rest of the page is allowed to show. */
  startFeature('dev-mode', initDevMode);
  startFeature('theme-toggle', initThemeToggle);
  startFeature('particles', initParticles);
  startFeature('navbar', initNavbar);
  startFeature('lotus', initLotusAssembly);
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
