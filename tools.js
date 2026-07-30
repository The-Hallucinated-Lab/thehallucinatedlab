/* ============================================================
   tools.js — Prompt filtering & copy-to-clipboard for the
   Tools page.
   ============================================================ */

/* ============ PROMPT CATEGORY FILTER ============ */
function initPromptFilters() {
  const filters = document.getElementById('prompt-filters');
  const grid = document.getElementById('prompt-grid');
  const empty = document.getElementById('prompt-empty');
  if (!filters || !grid) return;

  const cards = [...grid.querySelectorAll('.prompt-card')];

  filters.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      let shown = 0;

      cards.forEach(card => {
        const match = filter === 'all' || card.dataset.category === filter;
        card.style.display = match ? '' : 'none';
        // Cards are revealed on scroll; a card filtered back in below the
        // fold would otherwise stay at opacity 0 forever.
        if (match) {
          card.classList.add('visible');
          shown++;
        }
      });

      if (empty) empty.style.display = shown === 0 ? 'block' : 'none';
    });
  });
}

/* ============ COPY TO CLIPBOARD ============ */
/* execCommand is deprecated but still the only path that works from
   file:// and plain http — and it also covers the case where the async
   API rejects because the document has lost focus. */
function legacyCopy(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    ok ? resolve() : reject(new Error('copy command rejected'));
  });
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    const label = btn.querySelector('span');
    const original = label ? label.textContent : '';

    btn.addEventListener('click', () => {
      const card = btn.closest('.prompt-card, .how-block');
      const code = card ? card.querySelector('code') : null;
      if (!code) return;

      copyText(code.innerText)
        .then(() => {
          btn.classList.add('copied');
          if (label) label.textContent = 'Copied';
        })
        .catch(() => {
          if (label) label.textContent = 'Press Ctrl+C';
        })
        .finally(() => {
          setTimeout(() => {
            btn.classList.remove('copied');
            if (label) label.textContent = original;
          }, 2000);
        });
    });
  });
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  initPromptFilters();
  initCopyButtons();
});
