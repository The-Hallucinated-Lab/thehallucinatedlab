/* ============================================================
   solutions.js — ScoobyBench screenshot tab switcher.
   Extracted from solutions.html so the page's Content-Security-Policy
   can forbid inline script.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.sb-tab');
  const screens = document.querySelectorAll('.sb-screen');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.toggle('active', t === tab));
    screens.forEach(s => s.classList.toggle('active', s.dataset.screen === tab.dataset.screen));
  }));
});
