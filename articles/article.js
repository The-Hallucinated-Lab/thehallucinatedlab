/* ============================================================
   article.js — GSAP ScrollTrigger engine for interactive articles
   Requires: gsap.min.js + ScrollTrigger.min.js loaded before this
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Wait for GSAP to be available
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    console.warn('GSAP or ScrollTrigger not loaded — falling back to CSS animations.');
    // Fallback: just reveal everything
    document.querySelectorAll('.gsap-reveal').forEach(el => {
      el.style.opacity = '1';
      el.style.visibility = 'visible';
    });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ============ PROGRESS BAR ============ */
  const progressBar = document.getElementById('reading-progress');
  if (progressBar) {
    gsap.to(progressBar, {
      width: '100%',
      ease: 'none',
      scrollTrigger: {
        trigger: 'body',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.3,
      },
    });
  }

  /* ============ PARALLAX HERO ============ */
  const heroBg = document.querySelector('.article-hero-bg');
  if (heroBg) {
    gsap.to(heroBg, {
      yPercent: 30,
      ease: 'none',
      scrollTrigger: {
        trigger: '.article-hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });
  }

  /* ============ SCROLL REVEALS ============ */
  const revealElements = gsap.utils.toArray('.gsap-reveal');
  revealElements.forEach((el) => {
    gsap.fromTo(el,
      { autoAlpha: 0, y: 40 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 88%',
          toggleActions: 'play none none reverse',
        },
      }
    );
  });

  /* ============ HEADING ANIMATIONS ============ */
  const headings = gsap.utils.toArray('.article-content h2, .article-content h3');
  headings.forEach((heading) => {
    if (!heading.classList.contains('gsap-reveal')) {
      gsap.fromTo(heading,
        { autoAlpha: 0, x: -20 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.6,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: heading,
            start: 'top 88%',
            toggleActions: 'play none none reverse',
          },
        }
      );
    }
  });

  /* ============ STICKY TOC ACTIVE HIGHLIGHTING ============ */
  const tocLinks = document.querySelectorAll('.toc-link');
  const sections = document.querySelectorAll('.article-content h2[id]');

  if (tocLinks.length && sections.length) {
    sections.forEach((section) => {
      ScrollTrigger.create({
        trigger: section,
        start: 'top 30%',
        end: 'bottom 30%',
        onEnter: () => setActiveToc(section.id),
        onEnterBack: () => setActiveToc(section.id),
      });
    });
  }

  function setActiveToc(id) {
    tocLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
    });
  }

  /* ============ INTERACTIVE BOXES ============ */
  const boxes = gsap.utils.toArray('.interactive-box');
  boxes.forEach((box) => {
    gsap.fromTo(box,
      { autoAlpha: 0, scale: 0.95 },
      {
        autoAlpha: 1,
        scale: 1,
        duration: 0.6,
        ease: 'back.out(1.4)',
        scrollTrigger: {
          trigger: box,
          start: 'top 85%',
          toggleActions: 'play none none reverse',
        },
      }
    );
  });

  /* ============ BLOCKQUOTE ENTRANCE ============ */
  const quotes = gsap.utils.toArray('.article-content blockquote');
  quotes.forEach((quote) => {
    gsap.fromTo(quote,
      { autoAlpha: 0, x: -30, borderLeftColor: 'transparent' },
      {
        autoAlpha: 1,
        x: 0,
        borderLeftColor: '#c9a84c',
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: quote,
          start: 'top 85%',
          toggleActions: 'play none none reverse',
        },
      }
    );
  });

  /* ============ DEEP DIVE ANIMATION ============ */
  const deepDives = gsap.utils.toArray('.deep-dive');
  deepDives.forEach((dd) => {
    gsap.fromTo(dd,
      { autoAlpha: 0, y: 20 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: dd,
          start: 'top 88%',
          toggleActions: 'play none none reverse',
        },
      }
    );
  });

  /* ============ COPY-TO-CLIPBOARD ============ */
  document.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pre = btn.closest('pre');
      const code = pre ? pre.querySelector('code') : null;
      if (code) {
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.classList.add('copied');
          btn.textContent = '✓';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.textContent = '⎘';
          }, 2000);
        });
      }
    });
  });

  /* ============ SMOOTH SCROLL FOR TOC ============ */
  tocLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target) {
        gsap.to(window, {
          duration: 0.8,
          scrollTo: { y: target, offsetY: 100 },
          ease: 'power2.inOut',
        });
      }
    });
  });
});
