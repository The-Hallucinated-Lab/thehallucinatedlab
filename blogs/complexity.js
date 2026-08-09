/* ============================================================
   complexity.js — interactive figures for the complexity article.
   Extracted from complexity.html so the page's Content-Security-Policy
   can forbid inline script.

   No colour is written down in this file. Every one is read from a CSS
   custom property at draw time, which is what lets the chart follow the
   site's light/dark theme: the SVG is regenerated as a string, so a
   hardcoded #0f1116 plot background stayed dark on a sand page no matter
   what the stylesheet said. The curve colours live in complexity.css
   next to the note explaining how they were validated.
   ============================================================ */

/* Read once per draw rather than once per file: the values change when
   the theme does. */
function token(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

// ============ TAB SWITCHING ============
const tabs = document.querySelectorAll('#tabs button');
const sections = document.querySelectorAll('section');
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    window.scrollTo({top: 0, behavior: 'smooth'});
  });
});

// ============ GROWTH EXPLORER ============
/* `slot` names the CSS custom property this curve is painted in. The
   eight were generated and validated as one ordered set, so a curve keeps
   its slot even when its neighbours are toggled off — colour follows the
   series, never its rank among the visible ones. */
const funcs = [
  {name: 'O(1)',        f: _n => 1,              slot: '--cx-c1', on: true},
  {name: 'O(log n)',    f: n => Math.log2(n+1),  slot: '--cx-c2', on: true},
  {name: 'O(√n)',       f: n => Math.sqrt(n),    slot: '--cx-c3', on: false},
  {name: 'O(n)',        f: n => n,               slot: '--cx-c4', on: true},
  {name: 'O(n log n)',  f: n => n*Math.log2(n+1),slot: '--cx-c5', on: true},
  {name: 'O(n²)',       f: n => n*n,             slot: '--cx-c6', on: true},
  {name: 'O(n³)',       f: n => n*n*n,           slot: '--cx-c7', on: false},
  {name: 'O(2ⁿ)',       f: n => Math.pow(2,n),   slot: '--cx-c8', on: false},
];

const curveColour = fn => token(fn.slot, '#c9a84c');

const chart = document.getElementById('chart');
const controls = document.getElementById('controls');
const nSlider = document.getElementById('nSlider');
const nVal = document.getElementById('nVal');

function renderControls() {
  controls.innerHTML = '';
  funcs.forEach((f, i) => {
    const colour = curveColour(f);
    const el = document.createElement('span');
    el.className = 'toggle' + (f.on ? ' on' : '');
    /* Only the fill is set here — the label colour that has to invert
       against it is .toggle.on's job, so it stays theme-aware. */
    el.style.background = f.on ? colour : '';
    el.innerHTML = '<span class="dot" style="background:' + colour + '"></span>' + f.name;
    el.addEventListener('click', () => {
      funcs[i].on = !funcs[i].on;
      renderControls();
      drawChart();
    });
    controls.appendChild(el);
  });
}

function drawChart() {
  const maxN = parseInt(nSlider.value);
  const yscale = document.querySelector('input[name=yscale]:checked').value;
  const W = 800, H = 420;
  const PAD_L = 55, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const active = funcs.filter(f => f.on);
  const values = [];
  const step = Math.max(1, Math.floor(maxN / 200));
  for (let n = 1; n <= maxN; n += step) {
    active.forEach(f => values.push(f.f(n)));
  }
  const ymax = Math.max(...values, 1);
  const ymin = yscale === 'log' ? 0.5 : 0;

  function scaleX(n) { return PAD_L + (n / maxN) * plotW; }
  function scaleY(y) {
    if (yscale === 'log') {
      const ly = Math.log10(Math.max(y, 0.5));
      const lymax = Math.log10(ymax);
      const lymin = Math.log10(ymin);
      return PAD_T + plotH - ((ly - lymin) / (lymax - lymin)) * plotH;
    }
    return PAD_T + plotH - (y / ymax) * plotH;
  }

  /* The surface, the grid and the ink all come from the theme. The grid
     is drawn from the border token rather than a mid-grey so it stays
     recessive on both a near-black and a sand page. */
  const surface = token('--bg-secondary', '#0a0a0a');
  const gridInk = token('--border-subtle', 'rgba(201,168,76,0.1)');
  const tickInk = token('--text-muted', '#807b72');
  const axisInk = token('--text-secondary', '#9a9590');
  const mono = token('--font-body', 'ui-monospace, monospace');

  let svg = '';
  // Background grid
  svg += '<rect x="'+PAD_L+'" y="'+PAD_T+'" width="'+plotW+'" height="'+plotH+'" fill="'+surface+'" stroke="'+gridInk+'"/>';
  // Gridlines
  for (let i = 0; i <= 5; i++) {
    const y = PAD_T + (plotH * i / 5);
    svg += '<line x1="'+PAD_L+'" x2="'+(PAD_L+plotW)+'" y1="'+y+'" y2="'+y+'" stroke="'+gridInk+'" stroke-dasharray="2,4"/>';
  }
  for (let i = 0; i <= 5; i++) {
    const x = PAD_L + (plotW * i / 5);
    svg += '<line x1="'+x+'" x2="'+x+'" y1="'+PAD_T+'" y2="'+(PAD_T+plotH)+'" stroke="'+gridInk+'" stroke-dasharray="2,4"/>';
    const tickValue = Math.round(maxN * i / 5);
    svg += '<text x="'+x+'" y="'+(H-PAD_B+18)+'" fill="'+tickInk+'" font-size="11" text-anchor="middle" font-family="'+mono+'">'+tickValue+'</text>';
  }
  // Y-axis labels
  for (let i = 0; i <= 5; i++) {
    const y = PAD_T + (plotH * i / 5);
    let val;
    if (yscale === 'log') {
      const ly = Math.log10(ymax) - (Math.log10(ymax) - Math.log10(ymin)) * i / 5;
      val = Math.pow(10, ly);
    } else {
      val = ymax * (1 - i/5);
    }
    let label;
    if (val >= 1e9) label = (val/1e9).toFixed(1) + 'B';
    else if (val >= 1e6) label = (val/1e6).toFixed(1) + 'M';
    else if (val >= 1e3) label = (val/1e3).toFixed(1) + 'K';
    else if (val >= 1) label = Math.round(val);
    else label = val.toFixed(2);
    svg += '<text x="'+(PAD_L-8)+'" y="'+(y+4)+'" fill="'+tickInk+'" font-size="11" text-anchor="end" font-family="'+mono+'">'+label+'</text>';
  }

  // Axis labels
  svg += '<text x="'+(PAD_L+plotW/2)+'" y="'+(H-5)+'" fill="'+axisInk+'" font-size="12" text-anchor="middle">input size n</text>';
  svg += '<text x="15" y="'+(PAD_T+plotH/2)+'" fill="'+axisInk+'" font-size="12" text-anchor="middle" transform="rotate(-90 15 '+(PAD_T+plotH/2)+')">operations</text>';

  // Draw each curve
  active.forEach(fn => {
    let path = '';
    let first = true;
    for (let n = 1; n <= maxN; n += step) {
      const y = fn.f(n);
      if (yscale === 'linear' && y > ymax * 1.1) continue;
      const px = scaleX(n);
      const py = scaleY(y);
      if (isFinite(py) && py >= PAD_T && py <= PAD_T + plotH) {
        path += (first ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
        first = false;
      }
    }
    svg += '<path d="'+path+'" fill="none" stroke="'+curveColour(fn)+'" stroke-width="2" stroke-linejoin="round"/>';
  });

  chart.innerHTML = svg;
}

nSlider.addEventListener('input', () => {
  nVal.textContent = nSlider.value;
  drawChart();
});
document.querySelectorAll('input[name=yscale]').forEach(r => r.addEventListener('change', drawChart));

renderControls();
drawChart();

// ============ MASTER THEOREM CALCULATOR ============
const mtA = document.getElementById('mt-a');
const mtB = document.getElementById('mt-b');
const mtD = document.getElementById('mt-d');
const mtResult = document.getElementById('mt-result');

function computeMT() {
  const a = parseFloat(mtA.value);
  const b = parseFloat(mtB.value);
  const d = parseFloat(mtD.value);

  if (!isFinite(a) || !isFinite(b) || !isFinite(d) || a < 1 || b <= 1) {
    mtResult.innerHTML = '<div class="verdict invalid">Enter valid values (a ≥ 1, b > 1).</div>';
    return;
  }

  const cStar = Math.log(a) / Math.log(b);
  let caseNum, solution, explanation;
  const eps = 1e-9;

  if (d < cStar - eps) {
    caseNum = 1;
    solution = 'Θ(n^' + cStar.toFixed(3) + ')';
    if (Math.abs(cStar - Math.round(cStar)) < 1e-6) solution = 'Θ(n^' + Math.round(cStar) + ')';
    explanation = 'f(n) grows slower than n^(c*). Leaves of the recursion tree dominate the work.';
  } else if (Math.abs(d - cStar) < eps) {
    caseNum = 2;
    if (Math.abs(cStar - Math.round(cStar)) < 1e-6) {
      const p = Math.round(cStar);
      solution = p === 0 ? 'Θ(log n)' : (p === 1 ? 'Θ(n log n)' : 'Θ(n^' + p + ' log n)');
    } else {
      solution = 'Θ(n^' + cStar.toFixed(3) + ' · log n)';
    }
    explanation = 'f(n) = Θ(n^(c*)). Every level of the recursion tree does equal work. There are log n levels.';
  } else {
    caseNum = 3;
    if (Math.abs(d - Math.round(d)) < 1e-6) {
      const p = Math.round(d);
      solution = p === 0 ? 'Θ(1)' : (p === 1 ? 'Θ(n)' : 'Θ(n^' + p + ')');
    } else {
      solution = 'Θ(n^' + d + ')';
    }
    explanation = 'f(n) grows faster than n^(c*). The root of the recursion tree dominates the work.';
  }

  mtResult.innerHTML =
    '<div class="verdict">T(n) = ' + solution + '</div>' +
    '<div>a = ' + a + ', b = ' + b + ', so <span class="case">c* = log_' + b + '(' + a + ') ≈ ' + cStar.toFixed(3) + '</span></div>' +
    '<div>f(n) = Θ(n^' + d + '), comparing d = ' + d + ' with c* ≈ ' + cStar.toFixed(3) + '</div>' +
    '<div class="mt-note">→ <strong class="case">Case ' + caseNum + '</strong>: ' + explanation + '</div>';
}

[mtA, mtB, mtD].forEach(el => el.addEventListener('input', computeMT));
computeMT();

/* The formula sheet's print button. This lives here rather than as an
   inline onclick because the page ships script-src 'self' with no
   'unsafe-inline' — an inline handler is silently blocked by CSP. */
const printBtn = document.getElementById('print-sheet');
if (printBtn) printBtn.addEventListener('click', () => window.print());

/* The chart is an SVG string, so it does not repaint itself when the
   theme changes the way real elements do — it has to be redrawn. theme.js
   flips data-theme on <html> and dispatches nothing, so this watches the
   attribute. It runs for the life of the page, which is the whole point;
   there is nothing to disconnect it from. */
new MutationObserver(() => {
  renderControls();
  drawChart();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
