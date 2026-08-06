/* ============================================================
   eda.js — page glue for the runner on eda.html.

   Same shape as convert.js: this file moves values between the DOM and
   the engine and owns nothing else. All the analysis lives in
   eda-engine.js, which has no DOM in it and is unit tested.

   The one thing that lives here rather than there is chart drawing,
   because a chart is pixels and pixels need a canvas.

   Failure model:
     - Unreadable file (binary, wrong encoding) -> the status line says
       which, and the drop zone stays ready for another file.
     - Parquet or XLSX -> rejected at the door with the reason, rather
       than parsed into nonsense. The Python package reads those.
     - Analysis throws -> message in the status line, previous result
       stays downloadable.
     - More rows than the engine's cap -> analysed as a sample, and
       every artefact says so. Never silently truncated.
   ============================================================ */
(function () {
  'use strict';

  var eda = window.THL && window.THL.eda;

  var TEXT_EXT = ['csv', 'tsv', 'txt', 'json', 'jsonl', 'ndjson'];
  var BINARY_EXT = { parquet: 'Parquet', xlsx: 'Excel', xls: 'Excel', feather: 'Feather', orc: 'ORC' };

  /* Reading a very large file into a string will take the tab down
     before the engine ever gets a chance to sample. Refuse early. */
  var MAX_BYTES = 100 * 1024 * 1024;

  var sourceFile = null;
  var table = null;
  var result = null;
  var downloadUrl = null;
  var busy = false;
  var el = {};

  document.addEventListener('DOMContentLoaded', function () {
    el = {
      drop: document.getElementById('eda-drop'),
      dropTitle: document.getElementById('eda-drop-title'),
      dropHint: document.getElementById('eda-drop-hint'),
      pick: document.getElementById('eda-pick'),
      file: document.getElementById('eda-file'),
      controls: document.getElementById('eda-controls'),
      header: document.getElementById('opt-header'),
      delimiter: document.getElementById('opt-delimiter'),
      target: document.getElementById('opt-target'),
      tier2: document.getElementById('opt-tier2'),
      charts: document.getElementById('opt-charts'),
      run: document.getElementById('eda-run'),
      status: document.getElementById('eda-status'),
      result: document.getElementById('eda-result'),
      summary: document.getElementById('eda-summary'),
      schema: document.getElementById('eda-schema'),
      warnings: document.getElementById('eda-warnings'),
      figures: document.getElementById('eda-figures'),
      download: document.getElementById('eda-download'),
      bundle: document.getElementById('eda-bundle')
    };

    if (!el.drop) return;
    if (!eda) {
      setStatus('The analysis engine did not load. Reload the page.', true);
      return;
    }
    bindEvents();
  });

  /* A profile of a 50k-row file holds real memory. Let it go. */
  window.addEventListener('pagehide', releaseUrl);

  function releaseUrl() {
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  }

  function bindEvents() {
    el.pick.addEventListener('click', function () { el.file.click(); });
    el.file.addEventListener('change', function () {
      if (el.file.files && el.file.files.length) acceptFile(el.file.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      el.drop.addEventListener(name, function (e) {
        e.preventDefault();
        el.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      el.drop.addEventListener(name, function (e) {
        e.preventDefault();
        el.drop.classList.remove('is-over');
      });
    });
    el.drop.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) acceptFile(files[0]);
    });

    el.header.addEventListener('change', reparse);
    el.delimiter.addEventListener('change', reparse);
    el.run.addEventListener('click', run);
  }

  function extensionOf(name) {
    var parts = String(name).toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  function acceptFile(file) {
    var ext = extensionOf(file.name);

    if (BINARY_EXT[ext]) {
      setStatus(BINARY_EXT[ext] + ' files need a binary parser this page does not ship. ' +
        'Export it as CSV, or run `thl eda` from the Python package — that reads ' + ext + ' directly.', true);
      return;
    }
    if (TEXT_EXT.indexOf(ext) === -1) {
      setStatus('Unsupported file type. This page reads ' + TEXT_EXT.join(', ') + '.', true);
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus(formatBytes(file.size) + ' is too large to read into a browser tab. ' +
        'Use the Python package for a file this size.', true);
      return;
    }

    sourceFile = file;
    el.dropTitle.textContent = file.name;
    el.dropHint.textContent = formatBytes(file.size) + ' · reading…';
    el.run.disabled = true;
    hideResult();

    readText(file)
      .then(function (text) {
        sourceFile.text = text;
        reparse();
      })
      .catch(function (err) {
        setStatus(err.message || 'That file could not be read as text.', true);
        sourceFile = null;
        el.dropHint.textContent = 'Drop another file to try again';
      });
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('The file could not be read.')); };
      reader.onload = function () {
        var text = String(reader.result || '');
        /* A NUL in the first few KB means this is binary wearing a .csv
           extension. Parsing it produces confident nonsense. */
        if (text.slice(0, 8192).indexOf('\u0000') !== -1) {
          reject(new Error('That looks like a binary file, not text.'));
          return;
        }
        resolve(text);
      };
      reader.readAsText(file);
    });
  }

  /* Re-runs the parse (not the analysis) whenever a read option
     changes, so the column list and the preview stay honest. */
  function reparse() {
    if (!sourceFile || !sourceFile.text) return;
    var ext = extensionOf(sourceFile.name);
    var isJson = ext === 'json' || ext === 'jsonl' || ext === 'ndjson';

    try {
      table = eda.parseTable(sourceFile.text, {
        format: isJson ? 'json' : 'delimited',
        header: el.header.value !== 'none',
        delimiter: delimiterValue()
      });
    } catch (err) {
      setStatus(err.message || 'That file could not be parsed.', true);
      table = null;
      el.run.disabled = true;
      return;
    }

    if (!table.columns.length || !table.rows.length) {
      setStatus('No rows found in that file.', true);
      el.run.disabled = true;
      return;
    }

    buildTargetOptions();
    el.controls.hidden = false;
    el.run.disabled = false;

    var note = table.rows.length.toLocaleString('en-US') + ' rows × ' + table.columns.length + ' columns';
    if (table.truncated) {
      note += ' · sampled from ' + table.totalRows.toLocaleString('en-US');
    }
    if (table.delimiter) {
      note += ' · delimiter ' + (table.delimiter === '\t' ? 'tab' : '"' + table.delimiter + '"');
    }
    el.dropHint.textContent = formatBytes(sourceFile.size) + ' · ' + note;
    setStatus('');
  }

  function delimiterValue() {
    var v = el.delimiter.value;
    if (v === 'auto') return null;
    if (v === 'tab') return '\t';
    return v;
  }

  function buildTargetOptions() {
    var previous = el.target.value;
    el.target.textContent = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = 'none';
    el.target.appendChild(none);
    table.columns.forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      el.target.appendChild(option);
    });
    if (previous && table.columns.indexOf(previous) !== -1) el.target.value = previous;
  }

  function run() {
    if (busy || !table) return;
    busy = true;
    el.run.disabled = true;
    setStatus('Analysing…');

    /* Yield a frame first so the status actually paints before the
       synchronous pass starts. Without this the page looks frozen. */
    requestAnimationFrame(function () {
      setTimeout(function () {
        try {
          analyse();
        } catch (err) {
          console.error('[eda] analysis failed:', err);
          setStatus(err.message || 'The analysis failed.', true);
        }
        busy = false;
        el.run.disabled = !table;
      }, 0);
    });
  }

  function analyse() {
    var wantTier2 = el.tier2.checked;
    var wantCharts = el.charts.checked;
    var target = el.target.value || null;

    var prof = eda.profile(table, {});
    var corr = wantTier2 ? eda.correlations(table, prof) : null;

    var meta = {
      filename: sourceFile.name,
      delimiter: table.delimiter,
      target: target,
      generatedAt: new Date().toISOString()
    };

    var inferred = {};
    prof.columns.forEach(function (c) { inferred[c.name] = c.type; });

    var recipe = {
      tool: 'eda',
      source: sourceFile.name,
      generatedAt: meta.generatedAt,
      runtime: 'browser',
      format: (extensionOf(sourceFile.name) === 'json' ? 'json' : 'delimited'),
      delimiter: table.delimiter,
      header: el.header.value !== 'none',
      target: target,
      tier2: wantTier2,
      charts: wantCharts,
      rowsAnalysed: prof.rows,
      rowsInFile: prof.totalRows,
      sampled: prof.sampled,
      inferred: inferred
    };

    var figures = wantCharts ? drawFigures(prof, corr) : [];

    result = {
      profile: prof,
      correlations: corr,
      recipe: recipe,
      meta: meta,
      markdown: eda.reportMarkdown(prof, corr, meta),
      figures: figures
    };

    showResult();
  }

  /* ---- charts ------------------------------------------------------
     Canvas rather than SVG because the output has to end up as a PNG in
     the download, and toBlob gives that for free. */

  var CHART_W = 640;
  var CHART_H = 400;

  /* Read from the stylesheet rather than hard-coded, because the site
     has a light theme in which every one of these roles inverts —
     --gold-primary is gold on the dark page and near-black on the gold
     one. Hard-coding the dark values would paint a dark card onto a
     gold page, and the bars would come out the same colour as the
     background they sit on.

     Read per chart rather than once, so a theme switch mid-session
     produces correctly coloured figures on the next run. */
  var FALLBACK = { panel: '#0f0f0f', ink: '#f0ece4', muted: '#807b72', accent: '#c9a84c' };

  function themeColours() {
    var css = window.getComputedStyle(document.documentElement);
    var pick = function (name, fallback) {
      var value = css.getPropertyValue(name);
      return value && value.trim() ? value.trim() : fallback;
    };
    return {
      panel: pick('--bg-card', FALLBACK.panel),
      ink: pick('--text-primary', FALLBACK.ink),
      muted: pick('--text-muted', FALLBACK.muted),
      accent: pick('--gold-primary', FALLBACK.accent)
    };
  }

  function newCanvas() {
    var c = document.createElement('canvas');
    c.width = CHART_W;
    c.height = CHART_H;
    var ctx = c.getContext('2d');
    var colours = themeColours();
    ctx.fillStyle = colours.panel;
    ctx.fillRect(0, 0, CHART_W, CHART_H);
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    return { canvas: c, ctx: ctx, colours: colours };
  }

  function drawFigures(prof, corr) {
    var figures = [];

    prof.columns.forEach(function (col) {
      if (col.histogram && col.histogram.bins.length) {
        figures.push({ name: figureName(col.name, 'histogram'), canvas: histogramChart(col) });
      } else if (col.stats && col.stats.top && col.stats.top.length > 1 && col.type !== 'identifier') {
        figures.push({ name: figureName(col.name, 'counts'), canvas: barChart(col) });
      }
    });

    if (corr && corr.columns.length >= 2) {
      figures.push({ name: 'correlation_matrix', canvas: correlationChart(corr) });
    }
    return figures;
  }

  function figureName(column, kind) {
    return eda.slugify(column) + '_' + kind;
  }

  function axes(ctx, colours, title, subtitle) {
    ctx.fillStyle = colours.ink;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(title, 20, 26);
    if (subtitle) {
      ctx.fillStyle = colours.muted;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(subtitle, 20, 46);
    }
    ctx.font = '11px system-ui, sans-serif';
  }

  function histogramChart(col) {
    var made = newCanvas();
    var ctx = made.ctx;
    var colours = made.colours;
    var bins = col.histogram.bins;
    var left = 60, right = 20, top = 66, bottom = 46;
    var w = CHART_W - left - right;
    var h = CHART_H - top - bottom;
    var max = Math.max.apply(null, bins.map(function (b) { return b.count; })) || 1;

    axes(ctx, colours, col.name, 'distribution · n = ' + col.stats.count.toLocaleString('en-US'));

    ctx.strokeStyle = colours.muted;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(left, top); ctx.lineTo(left, top + h); ctx.lineTo(left + w, top + h);
    ctx.stroke();
    ctx.globalAlpha = 1;

    var barW = w / bins.length;
    ctx.fillStyle = colours.accent;
    bins.forEach(function (b, i) {
      var bh = (b.count / max) * h;
      ctx.fillRect(left + i * barW + 1, top + h - bh, Math.max(1, barW - 2), bh);
    });

    ctx.fillStyle = colours.muted;
    ctx.textAlign = 'center';
    ctx.fillText(fmt(col.histogram.min), left, top + h + 18);
    ctx.fillText(fmt(col.histogram.max), left + w, top + h + 18);
    ctx.textAlign = 'right';
    ctx.fillText(String(max), left - 8, top + 6);
    ctx.fillText('0', left - 8, top + h);
    ctx.textAlign = 'left';

    // median marker, because the eye reads the mode and the median is
    // the number that actually gets quoted.
    var span = col.histogram.max - col.histogram.min;
    if (span > 0 && col.stats.median !== null) {
      var x = left + ((col.stats.median - col.histogram.min) / span) * w;
      ctx.strokeStyle = colours.ink;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colours.ink;
      ctx.fillText('median ' + fmt(col.stats.median), Math.min(x + 6, CHART_W - 120), top + 12);
    }
    return made.canvas;
  }

  function barChart(col) {
    var made = newCanvas();
    var ctx = made.ctx;
    var colours = made.colours;
    var top = col.stats.top.slice(0, 12);
    var left = 150, right = 40, topPad = 66, bottom = 30;
    var w = CHART_W - left - right;
    var h = CHART_H - topPad - bottom;
    var max = Math.max.apply(null, top.map(function (t) { return t.count; })) || 1;
    var rowH = h / top.length;

    axes(ctx, colours, col.name, col.stats.unique.toLocaleString('en-US') + ' distinct values · top ' + top.length);

    top.forEach(function (t, i) {
      var y = topPad + i * rowH;
      var bw = (t.count / max) * w;
      ctx.fillStyle = colours.accent;
      ctx.fillRect(left, y + 2, bw, Math.max(2, rowH - 6));
      ctx.fillStyle = colours.ink;
      ctx.textAlign = 'right';
      var label = t.value === '' ? '(blank)' : t.value;
      if (label.length > 20) label = label.slice(0, 19) + '…';
      ctx.fillText(label, left - 10, y + rowH / 2);
      ctx.textAlign = 'left';
      ctx.fillStyle = colours.muted;
      ctx.fillText(String(t.count), left + bw + 6, y + rowH / 2);
    });
    return made.canvas;
  }

  function correlationChart(corr) {
    var made = newCanvas();
    var ctx = made.ctx;
    var colours = made.colours;
    var names = corr.columns.slice(0, 12);
    var left = 130, top = 76;
    var size = Math.min(CHART_W - left - 60, CHART_H - top - 40);
    var cell = size / names.length;

    axes(ctx, colours, 'Correlation matrix', 'Pearson r · ' + names.length + ' numeric columns');

    names.forEach(function (a, i) {
      names.forEach(function (b, j) {
        var r = corr.matrix[i][j];
        ctx.fillStyle = correlationColour(r, colours);
        ctx.fillRect(left + j * cell, top + i * cell, cell - 1, cell - 1);
      });
      ctx.fillStyle = colours.ink;
      ctx.textAlign = 'right';
      var label = a.length > 16 ? a.slice(0, 15) + '…' : a;
      ctx.fillText(label, left - 8, top + i * cell + cell / 2);
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = colours.muted;
    ctx.fillText('−1', left, top + size + 20);
    ctx.textAlign = 'right';
    ctx.fillText('+1', left + size, top + size + 20);
    ctx.textAlign = 'left';
    return made.canvas;
  }

  /* Positive uses the theme accent so it inverts with everything else.
     Negative keeps a fixed blue: it has to stay distinguishable from the
     accent in both themes, and the accent is gold in one and near-black
     in the other, so deriving it would collide with one of them. */
  function correlationColour(r, colours) {
    if (r === null || r === undefined) return 'rgba(128, 128, 128, 0.10)';
    var v = Math.max(-1, Math.min(1, r));
    if (v >= 0) return withAlpha(colours.accent, 0.12 + 0.88 * v);
    return 'rgba(64, 116, 180, ' + (0.12 + 0.88 * -v).toFixed(3) + ')';
  }

  /* The theme tokens are hex, and a heatmap cell needs an alpha. Falls
     back to the colour untouched for any format this does not know,
     which loses the shading but never paints something invalid. */
  function withAlpha(colour, alpha) {
    var hex = String(colour).trim();
    var match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    var body = match[1];
    if (body.length === 3) {
      body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
    }
    var n = parseInt(body, 16);
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) +
      ', ' + alpha.toFixed(3) + ')';
  }

  function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2);
  }

  /* ---- result rendering -------------------------------------------- */

  function showResult() {
    var prof = result.profile;

    el.summary.textContent = '';
    addFact(el.summary, prof.rows.toLocaleString('en-US') + ' rows analysed' +
      (prof.sampled ? ' (sampled from ' + prof.totalRows.toLocaleString('en-US') + ')' : ''));
    addFact(el.summary, prof.columns.length + ' columns');
    var flagged = prof.columns.filter(function (c) { return c.flagged; }).length;
    addFact(el.summary, flagged ? flagged + ' low-confidence type' + (flagged === 1 ? '' : 's') : 'all types confident');
    if (result.correlations && result.correlations.pairs.length) {
      var strongest = result.correlations.pairs[0];
      addFact(el.summary, 'strongest r = ' + strongest.r + ' (' + strongest.a + ' ~ ' + strongest.b + ')');
    }

    el.warnings.textContent = '';
    el.warnings.hidden = !prof.warnings.length;
    prof.warnings.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      el.warnings.appendChild(li);
    });

    renderSchema(prof);
    renderFigures();
    buildBundle();

    el.result.hidden = false;
    setStatus('Done — ' + prof.columns.length + ' columns profiled.');
  }

  function addFact(list, text) {
    var li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }

  function renderSchema(prof) {
    var body = el.schema.querySelector('tbody');
    body.textContent = '';
    prof.columns.forEach(function (c) {
      var tr = document.createElement('tr');
      if (c.flagged) tr.className = 'is-flagged';
      [
        c.name,
        c.type,
        c.confidence === null ? '—' : String(c.confidence) + (c.flagged ? ' ⚠' : ''),
        c.nulls + ' (' + (c.nullFraction * 100).toFixed(1) + '%)',
        String(c.unique)
      ].forEach(function (text, i) {
        var cell = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) cell.scope = 'row';
        cell.textContent = text;
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  function renderFigures() {
    el.figures.textContent = '';
    el.figures.hidden = !result.figures.length;
    result.figures.forEach(function (fig) {
      var wrap = document.createElement('figure');
      wrap.className = 'eda-figure';
      fig.canvas.setAttribute('role', 'img');
      fig.canvas.setAttribute('aria-label', fig.name.replace(/_/g, ' '));
      wrap.appendChild(fig.canvas);
      var caption = document.createElement('figcaption');
      caption.textContent = fig.name.replace(/_/g, ' ');
      wrap.appendChild(caption);
      el.figures.appendChild(wrap);
    });
  }

  /* ---- the download ------------------------------------------------ */

  function buildBundle() {
    var stem = eda.slugify(sourceFile.name);
    var entries = [
      { name: stem + '.eda/report.md', data: result.markdown },
      { name: stem + '.eda/summary.json', data: JSON.stringify({
          profile: result.profile,
          correlations: result.correlations
        }, null, 2) },
      { name: stem + '.eda/recipe.json', data: JSON.stringify(result.recipe, null, 2) },
      { name: stem + '.eda/analysis.py', data: eda.analysisScript(result.recipe) }
    ];

    el.download.disabled = true;
    el.bundle.textContent = 'Packaging…';

    Promise.all(result.figures.map(function (fig) {
      return canvasBytes(fig.canvas).then(function (bytes) {
        return { name: stem + '.eda/figures/' + fig.name + '.png', data: bytes };
      });
    })).then(function (figureEntries) {
      var all = entries.concat(figureEntries);
      var zip = eda.zipStore(all);
      releaseUrl();
      downloadUrl = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      el.download.href = downloadUrl;
      el.download.setAttribute('download', stem + '.eda.zip');
      el.download.disabled = false;
      el.bundle.textContent = all.length + ' files · ' + formatBytes(zip.length) +
        ' — report.md, summary.json, recipe.json, analysis.py' +
        (figureEntries.length ? ' and ' + figureEntries.length + ' figures' : '');
    }).catch(function (err) {
      console.error('[eda] bundle failed:', err);
      el.bundle.textContent = 'The download could not be packaged: ' + (err.message || 'unknown error');
    });
  }

  function canvasBytes(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('The chart could not be encoded.')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, 'image/png');
    });
  }

  /* ---- small helpers ------------------------------------------------ */

  function hideResult() {
    if (el.result) el.result.hidden = true;
  }

  function formatBytes(bytes) {
    var toolkit = window.THL && window.THL.toolkit;
    if (toolkit && toolkit.formatBytes) return toolkit.formatBytes(bytes);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function setStatus(message, isError) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.classList.toggle('is-error', !!isError);
  }

})();
