/* ============================================================
   redirect.js — shared client-side redirect for the renamed-page
   stubs (certificate.html, livelab.html, utilities.html).

   Each stub also carries a <meta http-equiv="refresh">, which is what
   actually moves visitors without JavaScript. This runs alongside it
   only to use location.replace(), so the stub does not land in the
   back-button history and trap anyone who tries to go back.

   Reads its target from <meta name="redirect-to">, which keeps the
   destination in the markup and lets the page's Content-Security-Policy
   forbid inline script.
   ============================================================ */
(function () {
  'use strict';
  var meta = document.querySelector('meta[name="redirect-to"]');
  var target = meta && meta.getAttribute('content');
  // Same-origin relative paths only — never anything that could be
  // turned into an open redirect.
  if (target && /^[\w.-]+\.html$/.test(target)) {
    window.location.replace(target);
  }
})();
