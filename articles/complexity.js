/* ============================================================
   complexity.js — interactive figures for the complexity article.
   Extracted from complexity.html so the page's Content-Security-Policy
   can forbid inline script.
   ============================================================ */

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
const funcs = [
  {name: 'O(1)',        f: n => 1,             color: '#6ee7a1', on: true},
  {name: 'O(log n)',    f: n => Math.log2(n+1),color: '#7cc4ff', on: true},
  {name: 'O(√n)',       f: n => Math.sqrt(n),  color: '#b78dff', on: false},
  {name: 'O(n)',        f: n => n,             color: '#ffb86b', on: true},
  {name: 'O(n log n)',  f: n => n*Math.log2(n+1),color: '#ff92c4', on: true},
  {name: 'O(n²)',       f: n => n*n,           color: '#ff8080', on: true},
  {name: 'O(n³)',       f: n => n*n*n,         color: '#ff5555', on: false},
  {name: 'O(2ⁿ)',       f: n => Math.pow(2,n), color: '#e0d000', on: false},
];

const chart = document.getElementById('chart');
const controls = document.getElementById('controls');
const nSlider = document.getElementById('nSlider');
const nVal = document.getElementById('nVal');

function renderControls() {
  controls.innerHTML = '';
  funcs.forEach((f, i) => {
    const el = document.createElement('span');
    el.className = 'toggle' + (f.on ? ' on' : '');
    el.style.background = f.on ? f.color : 'var(--panel)';
    el.style.color = f.on ? 'var(--bg)' : 'var(--muted)';
    el.innerHTML = '<span class="dot" style="background:' + f.color + '"></span>' + f.name;
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
  let ymax = Math.max(...values, 1);
  let ymin = yscale === 'log' ? 0.5 : 0;

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

  let svg = '';
  // Background grid
  svg += '<rect x="'+PAD_L+'" y="'+PAD_T+'" width="'+plotW+'" height="'+plotH+'" fill="#0f1116" stroke="#262a35"/>';
  // Gridlines
  for (let i = 0; i <= 5; i++) {
    const y = PAD_T + (plotH * i / 5);
    svg += '<line x1="'+PAD_L+'" x2="'+(PAD_L+plotW)+'" y1="'+y+'" y2="'+y+'" stroke="#262a35" stroke-dasharray="2,4"/>';
  }
  for (let i = 0; i <= 5; i++) {
    const x = PAD_L + (plotW * i / 5);
    svg += '<line x1="'+x+'" x2="'+x+'" y1="'+PAD_T+'" y2="'+(PAD_T+plotH)+'" stroke="#262a35" stroke-dasharray="2,4"/>';
    const nVal = Math.round(maxN * i / 5);
    svg += '<text x="'+x+'" y="'+(H-PAD_B+18)+'" fill="#9aa0ac" font-size="11" text-anchor="middle" font-family="ui-monospace,monospace">'+nVal+'</text>';
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
    svg += '<text x="'+(PAD_L-8)+'" y="'+(y+4)+'" fill="#9aa0ac" font-size="11" text-anchor="end" font-family="ui-monospace,monospace">'+label+'</text>';
  }

  // Axis labels
  svg += '<text x="'+(PAD_L+plotW/2)+'" y="'+(H-5)+'" fill="#e6e8ee" font-size="12" text-anchor="middle">input size n</text>';
  svg += '<text x="15" y="'+(PAD_T+plotH/2)+'" fill="#e6e8ee" font-size="12" text-anchor="middle" transform="rotate(-90 15 '+(PAD_T+plotH/2)+')">operations</text>';

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
    svg += '<path d="'+path+'" fill="none" stroke="'+fn.color+'" stroke-width="2.2" stroke-linejoin="round"/>';
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
    mtResult.innerHTML = '<div class="verdict" style="color:var(--warn)">Enter valid values (a ≥ 1, b > 1).</div>';
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
    '<div style="margin-top:8px;color:var(--muted)">→ <strong style="color:var(--accent-2)">Case ' + caseNum + '</strong>: ' + explanation + '</div>';
}

[mtA, mtB, mtD].forEach(el => el.addEventListener('input', computeMT));
computeMT();
