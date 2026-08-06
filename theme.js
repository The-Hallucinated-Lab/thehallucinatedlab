/* ============================================================
   theme.js — decides light or dark before the page paints.

   Loaded from <head> WITHOUT defer, deliberately. It has to set the
   attribute before the first paint or the visitor sees a flash of the
   wrong theme, and every trick for doing that cheaply is an inline
   script, which every page's CSP forbids (script-src 'self', no
   unsafe-inline). A tiny blocking same-origin file is the remaining
   option, and it is small enough that the parser pause is not the thing
   worth optimising.

   Precedence, highest first:
     1. What the visitor last chose here, in localStorage.
     2. What their OS asks for, via prefers-color-scheme.
     3. Dark, which is what this site has always been.

   Storage is wrapped because localStorage throws rather than returning
   null in a few real situations — Safari private mode historically, and
   any browser with site data blocked. A theme preference is not worth
   breaking the page over.

   Kept separate from script.js because that one is deferred, and by the
   time a deferred script runs the wrong theme has already been painted.
   ============================================================ */

(function () {
  'use strict';

  var KEY = 'thl_theme';

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (err) {
      return null;
    }
  }

  function systemPrefers() {
    // matchMedia is absent in very old browsers; dark is the safe default
    // because it is what the site looked like before this file existed.
    if (!window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  var theme = stored() || systemPrefers();
  document.documentElement.setAttribute('data-theme', theme);

  /* Exposed so script.js can drive the toggle without duplicating any of
     the storage or precedence rules. */
  window.THLTheme = {
    KEY: KEY,
    get: function () {
      return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    },
    set: function (next) {
      var value = next === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', value);
      try {
        localStorage.setItem(KEY, value);
      } catch (err) {
        /* Preference will not survive the session. The page still works. */
      }
      return value;
    },
    /* True only while the visitor has made no explicit choice, which is
       when following the OS live is the right behaviour. */
    isFollowingSystem: function () {
      return stored() === null;
    },
  };
})();
