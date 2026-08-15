/**
 * Navbar behaviour, shared by the hub and every term page.
 *
 * The menu-open class drops the navbar's backdrop-filter: a filtered element
 * becomes the containing block for its fixed descendants, which would trap the
 * open menu inside the 68px navbar strip.
 */
const navbar = document.querySelector('.navbar');
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');

if (navbar) {
  const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 10);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

if (toggle && links) {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    links.classList.toggle('open', !open);
    navbar.classList.toggle('menu-open', !open);
  });

  links.addEventListener('click', (event) => {
    if (event.target.tagName !== 'A') return;
    toggle.setAttribute('aria-expanded', 'false');
    links.classList.remove('open');
    navbar.classList.remove('menu-open');
  });
}
