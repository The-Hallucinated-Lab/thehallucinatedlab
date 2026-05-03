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

/* ============ PARTICLES ============ */
function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const particles = [];
  const { color, maxCount, densityFactor, connectionDistance, connectionOpacity, sizeRange, speedRange, opacityRange } = CONFIG.particles;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * (sizeRange[1] - sizeRange[0]) + sizeRange[0];
      this.speedX = (Math.random() - 0.5) * speedRange;
      this.speedY = (Math.random() - 0.5) * speedRange;
      this.opacity = Math.random() * (opacityRange[1] - opacityRange[0]) + opacityRange[0];
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${this.opacity})`;
      ctx.fill();
    }
  }

  const count = Math.min(maxCount, Math.floor(canvas.width * canvas.height / densityFactor));
  for (let i = 0; i < count; i++) particles.push(new Particle());

  function connectParticles() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < connectionDistance) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${connectionOpacity * (1 - dist / connectionDistance)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(); });
    connectParticles();
    requestAnimationFrame(animate);
  }
  animate();
}

/* ============ NAVBAR ============ */
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  const hamburger = document.querySelector('.nav-hamburger');
  const navLinks = document.querySelector('.nav-links');
  const links = document.querySelectorAll('.nav-links a');

  if (!navbar) return;

  // Scroll-aware background
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > CONFIG.navbar.scrollThreshold);
  });

  // Hamburger toggle with ARIA
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });

    links.forEach(link => link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
    }));

    // Close menu on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.focus();
      }
    });
  }

  // Active section highlighting via IntersectionObserver (replaces scroll-based detection)
  const sections = document.querySelectorAll('section[id]');
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const id = entry.target.getAttribute('id');
      const link = document.querySelector(`.nav-links a[href="#${id}"]`);
      if (link) {
        if (entry.isIntersecting) {
          links.forEach(l => l.classList.remove('active'));
          link.classList.add('active');
        }
      }
    });
  }, { threshold: 0.3, rootMargin: '-10% 0px -60% 0px' });

  sections.forEach(sec => sectionObserver.observe(sec));
}

/* ============ SCROLL ANIMATIONS ============ */
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
}

/* ============ TYPING EFFECT ============ */
function initTypingEffect() {
  const el = document.getElementById('typing-text');
  if (!el) return;

  const { texts, typeSpeed, deleteSpeed, pauseAfterType, pauseAfterDelete } = CONFIG.typing;
  let textIdx = 0;
  let charIdx = 0;
  let deleting = false;

  function type() {
    const current = texts[textIdx];
    el.textContent = current.substring(0, charIdx);

    if (!deleting && charIdx < current.length) {
      charIdx++;
      setTimeout(type, typeSpeed);
    } else if (!deleting && charIdx === current.length) {
      setTimeout(() => { deleting = true; type(); }, pauseAfterType);
    } else if (deleting && charIdx > 0) {
      charIdx--;
      setTimeout(type, deleteSpeed);
    } else {
      deleting = false;
      textIdx = (textIdx + 1) % texts.length;
      setTimeout(type, pauseAfterDelete);
    }
  }
  type();
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initNavbar();
  initScrollAnimations();
  initTypingEffect();
});
