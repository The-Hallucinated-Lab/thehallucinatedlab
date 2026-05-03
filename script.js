/* ============ PARTICLES ============ */
function initParticles() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 1.5 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.3;
      this.speedY = (Math.random() - 0.5) * 0.3;
      this.opacity = Math.random() * 0.4 + 0.1;
    }
    update() {
      this.x += this.speedX; this.y += this.speedY;
      if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(201, 168, 76, ${this.opacity})`;
      ctx.fill();
    }
  }

  const count = Math.min(80, Math.floor(canvas.width * canvas.height / 15000));
  for (let i = 0; i < count; i++) particles.push(new Particle());

  function connectParticles() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(201, 168, 76, ${0.06 * (1 - dist / 150)})`;
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

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  });

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
    });
    links.forEach(link => link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      hamburger.classList.remove('active');
    }));
  }

  // Active section highlighting
  const sections = document.querySelectorAll('section[id]');
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY + 100;
    sections.forEach(sec => {
      const top = sec.offsetTop;
      const height = sec.offsetHeight;
      const id = sec.getAttribute('id');
      const link = document.querySelector(`.nav-links a[href="#${id}"]`);
      if (link) {
        if (scrollY >= top && scrollY < top + height) link.classList.add('active');
        else link.classList.remove('active');
      }
    });
  });
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

/* ============ (GitHub section removed) ============ */

/* ============ TYPING EFFECT ============ */
function initTypingEffect() {
  const el = document.getElementById('typing-text');
  if (!el) return;
  const texts = ['No cloud lock-ins.', 'No paywalls. No ceilings.', 'Your data stays yours.', 'Fully local AI pipelines.', 'Open source. Always.'];
  let textIdx = 0, charIdx = 0, deleting = false;

  function type() {
    const current = texts[textIdx];
    el.textContent = current.substring(0, charIdx);

    if (!deleting && charIdx < current.length) {
      charIdx++;
      setTimeout(type, 80);
    } else if (!deleting && charIdx === current.length) {
      setTimeout(() => { deleting = true; type(); }, 2000);
    } else if (deleting && charIdx > 0) {
      charIdx--;
      setTimeout(type, 40);
    } else {
      deleting = false;
      textIdx = (textIdx + 1) % texts.length;
      setTimeout(type, 500);
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
