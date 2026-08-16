/**
 * Navbar behaviour, shared by the hub and every term page.
 *
 * The menu-open class drops the navbar's backdrop-filter: a filtered element
 * becomes the containing block for its fixed descendants, which would trap the
 * open menu inside the 68px navbar strip.
 */
const navbar = document.querySelector('.navbar');

if (navbar) {
  const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 10);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* The menu toggle used to be wired here against `.nav-toggle`, which is
   not what the markup ships — the button is `#nav-hamburger`, so the
   handler bound to nothing and the mobile menu on these pages was dead.
   It is not re-implemented here: script.js already owns the hamburger,
   the theme toggle and the dev/live mode for every page on the site,
   and these pages load it. A second implementation of the same control
   is how the two drift apart. */
