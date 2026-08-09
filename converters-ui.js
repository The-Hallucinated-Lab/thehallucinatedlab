/* ============================================================
   converters-ui.js — the panels on the Converters page.

   The DOM half of the page. The logic it drives lives in converters.js
   (text, tables, encodings) and convert-scales.js (units, bases, colour,
   time), both of which are pure and unit tested; this file only moves
   values between form controls and those functions.

   Split from the logic for two reasons. One is the 40 KB per-page script
   budget, which the single combined file broke at 53 KB. The other is
   that the split keeps the tested surface honest: nothing in here is
   testable without a browser, so nothing that matters is allowed to
   live here.

   Neither engine throws at this boundary. Both return a result object
   carrying either a value or a sentence for the visitor, so there is one
   error path per panel rather than a catch block per control.
   ============================================================ */

/* Both engines are published on window.THL by the scripts loaded before
   this one. Read once, so a missing script is one obvious failure at
   startup rather than a TypeError inside whichever panel ran first. */
const TEXT_ENGINE = (window.THL && window.THL.convert) || null;
const SCALE_ENGINE = (window.THL && window.THL.scales) || null;

/* ============ SHARED ============ */
function el(id) {
  return document.getElementById(id);
}

function setStatus(node, message, isError) {
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('is-error', Boolean(isError));
}

const esc = TEXT_ENGINE ? TEXT_ENGINE.escapeHtml : String;

/* navigator.clipboard is unavailable on http origins and inside some
   embedded webviews, so a failure says so rather than looking like the
   button did nothing. */
async function copyText(text, status) {
  if (!text) {
    setStatus(status, 'There is nothing to copy yet.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(status, 'Copied to the clipboard.');
  } catch (err) {
    setStatus(status, 'This browser would not let the page reach the clipboard — select the text and copy it.', true);
  }
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  /* Revoked a beat later rather than immediately: Safari cancels an
     in-flight download when the object URL disappears too early. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderRows(table, rows) {
  if (!table) return;
  table.innerHTML = rows.map(([label, value]) =>
    `<tr><th scope="row">${esc(label)}</th><td><code>${esc(value)}</code></td></tr>`).join('');
}

/* ============ PANEL: TEXT & DATA ============ */
function initTextPanel() {
  const select = el('conv-select');
  const groups = el('conv-groups');
  const input = el('conv-input');
  const output = el('conv-output');
  const hint = el('conv-hint');
  const status = el('conv-status');
  if (!select || !input || !output || !TEXT_ENGINE) return;

  let activeGroup = TEXT_ENGINE.CONVERSION_GROUPS[0].id;

  const showHint = () => {
    const conversion = TEXT_ENGINE.conversionById(select.value);
    if (hint) hint.textContent = conversion ? conversion.hint : '';
  };

  const convert = () => {
    const result = TEXT_ENGINE.runConversion(select.value, input.value);
    if (!result.ok) {
      output.value = '';
      setStatus(status, result.error, true);
      return;
    }
    output.value = result.output;
    const lines = result.output === '' ? 0 : result.output.split('\n').length;
    setStatus(status, `${result.output.length.toLocaleString('en-US')} characters, ${lines.toLocaleString('en-US')} lines.`);
  };

  const renderOptions = () => {
    const list = TEXT_ENGINE.TEXT_CONVERSIONS.filter(c => c.group === activeGroup);
    select.innerHTML = list.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
    showHint();
  };

  if (groups) {
    groups.innerHTML = TEXT_ENGINE.CONVERSION_GROUPS.map((g, i) =>
      `<button type="button" class="filter-btn${i === 0 ? ' active' : ''}" data-group="${esc(g.id)}">${esc(g.label)}</button>`).join('');
    groups.addEventListener('click', (event) => {
      const btn = event.target.closest('.filter-btn');
      if (!btn) return;
      activeGroup = btn.dataset.group;
      groups.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderOptions();
      if (input.value.trim()) convert();
    });
  }

  renderOptions();

  select.addEventListener('change', () => {
    showHint();
    if (input.value.trim()) convert();
  });

  const on = (id, handler) => {
    const node = el(id);
    if (node) node.addEventListener('click', handler);
  };

  on('conv-run', convert);
  on('conv-copy', () => copyText(output.value, status));
  on('conv-download', () => {
    if (!output.value) {
      setStatus(status, 'Convert something first.', true);
      return;
    }
    downloadText(output.value, `${select.value || 'converted'}.txt`);
  });
  on('conv-clear', () => {
    input.value = '';
    output.value = '';
    setStatus(status, '');
    input.focus();
  });
}

/* ============ PANEL: UNITS ============ */
function initUnitPanel() {
  const category = el('unit-category');
  const from = el('unit-from');
  const to = el('unit-to');
  const value = el('unit-value');
  const result = el('unit-result');
  const table = el('unit-table');
  const status = el('unit-status');
  if (!category || !from || !to || !value || !SCALE_ENGINE) return;

  const optionsFor = group => group.units.map(([code, label]) =>
    `<option value="${esc(code)}">${esc(label)} (${esc(code)})</option>`).join('');

  const currentGroup = () =>
    SCALE_ENGINE.UNIT_GROUPS.find(g => g.id === category.value) || SCALE_ENGINE.UNIT_GROUPS[0];

  const compute = () => {
    const group = currentGroup();
    const one = SCALE_ENGINE.convertUnit(value.value, from.value, to.value, group.id);
    if (!one.ok) {
      if (result) result.textContent = '—';
      if (table) table.innerHTML = '';
      setStatus(status, one.error, true);
      return;
    }
    if (result) result.textContent = `${SCALE_ENGINE.formatQuantity(one.value)} ${to.value}`;

    /* The whole group at once: the question after "how many feet is
       1.8 m" is almost always the same value in a third unit. */
    const all = SCALE_ENGINE.unitTable(value.value, from.value, group.id);
    if (table && all.ok) {
      table.innerHTML = all.rows.map(row =>
        `<tr${row.code === to.value ? ' class="is-target"' : ''}><th scope="row">${esc(row.label)}</th><td><code>${esc(row.text)}</code></td><td>${esc(row.code)}</td></tr>`).join('');
    }
    setStatus(status, '');
  };

  const fillUnits = () => {
    const group = currentGroup();
    from.innerHTML = optionsFor(group);
    to.innerHTML = optionsFor(group);
    from.value = group.units[0][0];
    to.value = (group.units[1] || group.units[0])[0];
    compute();
  };

  category.innerHTML = SCALE_ENGINE.UNIT_GROUPS.map(g =>
    `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
  fillUnits();

  category.addEventListener('change', fillUnits);
  [from, to].forEach(node => node.addEventListener('change', compute));
  value.addEventListener('input', compute);

  const swap = el('unit-swap');
  if (swap) {
    swap.addEventListener('click', () => {
      const held = from.value;
      from.value = to.value;
      to.value = held;
      compute();
    });
  }
}

/* ============ PANEL: NUMBER BASES ============ */
const BASE_TARGETS = [
  ['2', 'Binary'], ['8', 'Octal'], ['10', 'Decimal'],
  ['16', 'Hexadecimal'], ['32', 'Base 32'], ['36', 'Base 36'],
];

function initBasePanel() {
  const input = el('base-input');
  const from = el('base-from');
  const table = el('base-table');
  const status = el('base-status');
  if (!input || !from || !table || !SCALE_ENGINE) return;

  const compute = () => {
    if (!input.value.trim()) {
      table.innerHTML = '';
      setStatus(status, '');
      return;
    }
    const rows = [];
    for (const [base, label] of BASE_TARGETS) {
      const result = SCALE_ENGINE.convertBase(input.value, from.value, base);
      if (!result.ok) {
        table.innerHTML = '';
        setStatus(status, result.error, true);
        return;
      }
      rows.push([`${label} (base ${base})`, result.value]);
    }
    renderRows(table, rows);
    setStatus(status, '');
  };

  const { min, max } = SCALE_ENGINE.BASE_LIMITS;
  const NAMED = { 2: ' (binary)', 8: ' (octal)', 10: ' (decimal)', 16: ' (hex)' };
  from.innerHTML = Array.from({ length: max - min + 1 }, (_, i) => {
    const base = min + i;
    return `<option value="${base}"${base === 10 ? ' selected' : ''}>base ${base}${NAMED[base] || ''}</option>`;
  }).join('');

  input.addEventListener('input', compute);
  from.addEventListener('change', compute);
  compute();
}

/* ============ PANEL: COLOUR ============ */
function initColourPanel() {
  const input = el('colour-input');
  const picker = el('colour-picker');
  const swatch = el('colour-swatch');
  const table = el('colour-table');
  const status = el('colour-status');
  if (!input || !table || !SCALE_ENGINE) return;

  const compute = (source) => {
    const result = SCALE_ENGINE.colourFormats(source);
    if (!result.ok) {
      table.innerHTML = '';
      setStatus(status, result.error, true);
      return;
    }
    renderRows(table, result.rows);
    if (swatch) swatch.style.background = result.hex;
    if (picker && picker.value !== result.hex) picker.value = result.hex;
    setStatus(status, '');
  };

  input.addEventListener('input', () => compute(input.value));
  if (picker) {
    picker.addEventListener('input', () => {
      input.value = picker.value;
      compute(picker.value);
    });
  }
  compute(input.value || '#c9a84c');
}

/* ============ PANEL: TIME ============ */
function initTimePanel() {
  const input = el('time-input');
  const table = el('time-table');
  const status = el('time-status');
  if (!input || !table || !SCALE_ENGINE) return;

  const compute = () => {
    const result = SCALE_ENGINE.timeFormats(input.value);
    if (!result.ok) {
      table.innerHTML = '';
      setStatus(status, result.error, true);
      return;
    }
    renderRows(table, result.rows);
    setStatus(status, '');
  };

  input.addEventListener('input', compute);
  const now = el('time-now');
  if (now) {
    now.addEventListener('click', () => {
      input.value = String(Math.floor(Date.now() / 1000));
      compute();
    });
  }
  if (!input.value) input.value = String(Math.floor(Date.now() / 1000));
  compute();
}

/* ============ PANEL: IMAGES ============
   The one panel that is not text in, text out. A canvas can decode and
   re-encode an image, which is exactly why these operations are possible
   here and video is not.

   Format-only conversion lives on the Convert page, which has the
   argument spec and the Python parity behind it. What is here is the
   part that page does not do: scaling, and reading an image's real
   dimensions and weight. */
const IMAGE_MAX_PIXELS = 40000000;
const IMAGE_PREVIEW_MAX = 480;

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function initImagePanel() {
  const drop = el('img-drop');
  const picker = el('img-file');
  const status = el('img-status');
  const result = el('img-result');
  const preview = el('img-preview');
  const facts = el('img-facts');
  const download = el('img-download');
  const scale = el('img-scale');
  const scaleValue = el('img-scale-value');
  const format = el('img-format');
  if (!drop || !picker) return;

  let loaded = null;          // { image, name, bytes }
  let previousUrl = null;     // revoked on the next render, not leaked

  const render = () => {
    if (!loaded) return;
    const factor = Number(scale ? scale.value : 100) / 100;
    const width = Math.max(1, Math.round(loaded.image.naturalWidth * factor));
    const height = Math.max(1, Math.round(loaded.image.naturalHeight * factor));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    /* JPEG has no alpha channel, so without a painted backdrop every
       transparent pixel encodes as black. */
    const target = format ? format.value : 'image/png';
    if (target === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(loaded.image, 0, 0, width, height);

    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus(status, 'This browser could not encode that format. Try PNG.', true);
        return;
      }
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = URL.createObjectURL(blob);

      if (preview) {
        const shown = Math.min(width, IMAGE_PREVIEW_MAX);
        preview.src = previousUrl;
        preview.width = shown;
        preview.height = Math.max(1, Math.round((shown / width) * height));
      }
      if (download) {
        const ext = target.split('/')[1].replace('jpeg', 'jpg');
        download.href = previousUrl;
        download.download = `${loaded.name.replace(/\.[^.]+$/, '')}-${width}x${height}.${ext}`;
      }
      if (facts) {
        const delta = blob.size - loaded.bytes;
        facts.innerHTML = [
          ['Source', `${loaded.image.naturalWidth} × ${loaded.image.naturalHeight}, ${formatBytes(loaded.bytes)}`],
          ['Output', `${width} × ${height}, ${formatBytes(blob.size)}`],
          ['Change', `${delta < 0 ? '−' : '+'}${formatBytes(Math.abs(delta))}`],
        ].map(([k, v]) => `<li><span>${esc(k)}</span>${esc(v)}</li>`).join('');
      }
      if (result) result.hidden = false;
      setStatus(status, 'Encoded in this tab. Nothing was uploaded.');
    }, target, 0.92);
  };

  const load = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus(status, 'That is not an image file.', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth * image.naturalHeight > IMAGE_MAX_PIXELS) {
        setStatus(status, 'That image is over 40 megapixels — encoding it on the main thread would lock the tab.', true);
        return;
      }
      loaded = { image, name: file.name || 'image', bytes: file.size };
      if (scale) scale.value = '100';
      if (scaleValue) scaleValue.textContent = '100%';
      render();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus(status, 'This browser could not decode that image.', true);
    };
    image.src = url;
  };

  picker.addEventListener('change', () => load(picker.files && picker.files[0]));
  const pick = el('img-pick');
  if (pick) pick.addEventListener('click', () => picker.click());

  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', (e) => {
    load(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  if (scale) {
    scale.addEventListener('input', () => {
      if (scaleValue) scaleValue.textContent = `${scale.value}%`;
      render();
    });
  }
  if (format) format.addEventListener('change', render);
}

/* ============ INIT ============
   Every panel is independent, so one that throws must not take the
   others with it — a broken colour parser should not cost the visitor
   the unit converter. */
document.addEventListener('DOMContentLoaded', () => {
  [
    ['text', initTextPanel],
    ['units', initUnitPanel],
    ['bases', initBasePanel],
    ['colour', initColourPanel],
    ['time', initTimePanel],
    ['images', initImagePanel],
  ].forEach(([name, run]) => {
    try {
      run();
    } catch (err) {
      console.error(`[converters] ${name} panel failed:`, err);
    }
  });
});
