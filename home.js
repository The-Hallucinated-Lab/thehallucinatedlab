/* ============================================================
   home.js — the homepage's own behaviour. Loaded after script.js, which
   owns the shell (navbar, theme, dev mode, .fade-in reveals) and exposes
   shouldAnimate() and startFeature().

   Four things live here, all gated:
     - the hero lotus answering the pointer and resolving into geometry
       as the reader scrolls
     - the signal path and the privacy diagram lighting up once on entry
     - the Software / ML / AI selector (a tab list)
   Nothing here fetches, stores or reports anything.
   ============================================================ */

/* @pure-start — storage-free helpers, loaded under node by test/home.test.js */

/* Pointer position relative to an element's centre, normalised to -1..1
   and clamped, so a petal can lean toward the cursor by at most `max`
   pixels and never further. */
function petalOffset(dx, dy, half) {
  if (!(half > 0)) return { x: 0, y: 0 };
  const clamp = (v) => Math.max(-1, Math.min(1, v / half));
  return { x: clamp(dx), y: clamp(dy) };
}

/* How far through the hero the reader has scrolled, 0..1. The lotus is
   fully itself for the first fifth of the hero and fully geometry by the
   time the hero has scrolled away. */
function lotusPhase(scrollY, heroHeight) {
  if (!(heroHeight > 0)) return 0;
  const start = heroHeight * 0.2;
  const end = heroHeight * 0.9;
  if (scrollY <= start) return 0;
  if (scrollY >= end) return 1;
  return (scrollY - start) / (end - start);
}

/* Which tab a keypress should move to. Arrow keys wrap; Home/End jump. */
function nextTabIndex(key, current, count) {
  if (count <= 0) return 0;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return current;
}

/* @pure-end */

/* ---- Hero: pointer proximity + scroll-linked transform ---- */
function initHeroMark() {
  const mark = document.getElementById('hero-mark');
  const hero = document.getElementById('hero');
  if (!mark || !hero || !shouldAnimate()) return;

  /* Pointer: desktop only. A touch screen has no hover, and a mark that
     jumps to the last tap looks broken rather than responsive. */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const HALF = 220; // px from the mark's centre at which the lean saturates
    hero.addEventListener('pointermove', (event) => {
      const r = mark.getBoundingClientRect();
      const { x, y } = petalOffset(event.clientX - (r.left + r.width / 2), event.clientY - (r.top + r.height / 2), HALF);
      mark.style.setProperty('--px', x.toFixed(3));
      mark.style.setProperty('--py', y.toFixed(3));
    });
    hero.addEventListener('pointerleave', () => {
      mark.style.setProperty('--px', '0');
      mark.style.setProperty('--py', '0');
    });
  }

  /* Scroll: user-controlled, so it is a scroll listener writing one custom
     property inside rAF — never a timed animation. */
  let ticking = false;
  const update = () => {
    ticking = false;
    mark.style.setProperty('--phase', lotusPhase(window.scrollY, hero.offsetHeight).toFixed(3));
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/* ---- Diagrams that light once when they come into view ---- */
function initLiveDiagrams() {
  const targets = document.querySelectorAll('[data-live]');
  if (!targets.length) return;
  if (!('IntersectionObserver' in window) || !shouldAnimate()) {
    targets.forEach((el) => el.classList.add('is-live'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-live');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.35 });
  targets.forEach((el) => io.observe(el));
}

/* ---- Software / ML / AI selector ---- */
function initNeedsSelector() {
  const root = document.getElementById('needs-selector');
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  const panels = Array.from(root.querySelectorAll('[role="tabpanel"]'));
  if (!tabs.length || tabs.length !== panels.length) return;

  const select = (index, focus) => {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      panels[i].classList.toggle('is-active', on);
      panels[i].hidden = false; // visibility is the CSS crossfade's job
      panels[i].setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    if (focus) tabs[index].focus();
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i, false));
    tab.addEventListener('keydown', (event) => {
      const next = nextTabIndex(event.key, i, tabs.length);
      if (next === i) return;
      event.preventDefault();
      select(next, true);
    });
  });
  select(tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true') || 0, false);
}

document.addEventListener('DOMContentLoaded', () => {
  if (shouldAnimate()) document.documentElement.classList.add('thl-motion');
  startFeature('hero-mark', initHeroMark);
  startFeature('live-diagrams', initLiveDiagrams);
  startFeature('needs-selector', initNeedsSelector);
});
