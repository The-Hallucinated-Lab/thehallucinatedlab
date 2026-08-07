/* ============================================================
   tokenize.js — page glue for tokenize.html.

   Answers "how big is this, and what will it cost to embed" — not
   "convert this document into tokens". That distinction is the whole
   point of the page. An embedding model tokenizes internally with its
   own vocabulary; BGE-M3 is XLM-RoBERTa with roughly 250k SentencePiece
   pieces, so there is no file you can hand it that is "already
   tokenized". A tiktoken id stream is not a head start, it is a
   different alphabet.

   What a token count is genuinely for is deciding how to chunk, and
   knowing what a corpus costs before paying for it.

   The browser counts with toolkit.estimateTokens, a heuristic, because
   BGE-M3's real vocabulary is a ~17MB download. The page says so rather
   than presenting an estimate as a measurement. For exact figures the
   Python package loads the real tokenizer — which is still only the
   tokenizer, not the 2.3GB model.

   Failure model:
     - Spec fails to load -> drop zone disabled, panel says why.
     - Malformed JSONL -> names the line rather than the file.
     - Everything else is arithmetic and cannot fail.
   ============================================================ */
(function () {
  'use strict';

  var toolkit = window.THL && window.THL.toolkit;

  /* @pure-start — no DOM, no network, no module state. */

  /* One piece per JSONL record, or the whole document otherwise.

     A .jsonl input is assumed to be chunk's output, so each record is
     measured separately — which is the only way "how many pieces
     overflow the context window" is a meaningful question at all. */
  function piecesFrom(text, name) {
    var body = String(text || '').replace(/\r\n?/g, '\n');
    if (!/\.jsonl$/i.test(String(name || ''))) return [body];

    var pieces = [];
    var lines = body.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var record;
      try {
        record = JSON.parse(lines[i]);
      } catch (err) {
        throw new Error('Line ' + (i + 1) + ' is not valid JSON.');
      }
      if (!record || typeof record !== 'object' || record.text === undefined) {
        throw new Error('Line ' + (i + 1) + ' has no "text" field.');
      }
      pieces.push(String(record.text));
    }
    return pieces;
  }

  /* Nearest-rank percentile. No dependency for a one-line statistic. */
  function percentile(ordered, fraction) {
    if (!ordered.length) return 0;
    var index = Math.round(fraction * (ordered.length - 1));
    return ordered[Math.max(0, Math.min(ordered.length - 1, index))];
  }

  /* The distribution, not just the total. `overLimit` is the number that
     matters: a piece longer than the model's context is not an error at
     embed time, it is silently truncated, and its tail never reaches the
     vector. Finding that here is the point of the tool. */
  function analyze(pieces, limit, count) {
    var counts = [];
    for (var i = 0; i < pieces.length; i++) counts.push(count(pieces[i]));

    var ordered = counts.slice().sort(function (a, b) { return a - b; });
    var total = 0;
    var over = 0;
    var empty = 0;
    for (var j = 0; j < counts.length; j++) {
      total += counts[j];
      if (counts[j] > limit) over++;
      if (!counts[j]) empty++;
    }

    return {
      pieces: counts.length,
      total: total,
      smallest: ordered.length ? ordered[0] : 0,
      largest: ordered.length ? ordered[ordered.length - 1] : 0,
      mean: counts.length ? Math.round((total / counts.length) * 10) / 10 : 0,
      median: percentile(ordered, 0.5),
      p95: percentile(ordered, 0.95),
      overLimit: over,
      empty: empty,
      limit: limit
    };
  }

  /* A histogram of where the pieces fall, for the bar chart. Fixed
     buckets rather than computed ones, so two runs of the same corpus
     are comparable by eye. */
  function histogram(counts, limit) {
    var edges = [0, 64, 128, 256, 512, 1024, 2048, 4096, limit];
    var buckets = [];
    for (var b = 0; b < edges.length - 1; b++) {
      if (edges[b] >= limit) break;
      buckets.push({ from: edges[b], to: Math.min(edges[b + 1], limit), n: 0 });
    }
    buckets.push({ from: limit, to: Infinity, n: 0 });

    for (var i = 0; i < counts.length; i++) {
      for (var k = 0; k < buckets.length; k++) {
        if (counts[i] > buckets[k].from && counts[i] <= buckets[k].to) { buckets[k].n++; break; }
        if (k === buckets.length - 1 && counts[i] > limit) buckets[k].n++;
      }
    }
    return buckets;
  }

  /* @pure-end */

  /* ---- DOM glue ---- */

  var manifest = null;
  var tool = null;
  var sourceFile = null;
  var busy = false;
  var el = {};

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.className = 'tool-status' + (kind ? ' is-' + kind : '');
  }

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.readAsText(file);
    });
  }

  function row(label, value, note) {
    var li = document.createElement('li');
    var name = document.createElement('span');
    name.textContent = label;
    li.appendChild(name);
    li.appendChild(document.createTextNode(' ' + value + (note ? ' — ' + note : '')));
    return li;
  }

  function render(stats, counts) {
    while (el.facts.firstChild) el.facts.removeChild(el.facts.firstChild);
    el.facts.appendChild(row('pieces', stats.pieces.toLocaleString()));
    el.facts.appendChild(row('total', stats.total.toLocaleString() + ' tokens'));
    el.facts.appendChild(row('median', String(stats.median)));
    el.facts.appendChild(row('largest', String(stats.largest)));
    el.facts.appendChild(row('95th percentile', String(stats.p95)));
    el.facts.appendChild(row(
      'over ' + stats.limit,
      String(stats.overLimit),
      stats.overLimit ? 'these would be truncated at embed time' : 'nothing would be truncated'
    ));
    if (stats.empty) el.facts.appendChild(row('empty', String(stats.empty)));

    /* A text histogram rather than a chart: it needs no library, copies
       into a terminal, and reads the same in both themes. */
    var lines = [];
    var buckets = histogram(counts, stats.limit);
    var widest = 0;
    for (var i = 0; i < buckets.length; i++) widest = Math.max(widest, buckets[i].n);
    for (var b = 0; b < buckets.length; b++) {
      var label = buckets[b].to === Infinity
        ? '> ' + stats.limit
        : buckets[b].from + '-' + buckets[b].to;
      var width = widest ? Math.round((buckets[b].n / widest) * 32) : 0;
      lines.push(
        label.padStart(11) + '  ' +
        new Array(width + 1).join('#').padEnd(32) + ' ' + buckets[b].n
      );
    }
    el.preview.textContent = lines.join('\n');
    el.result.hidden = false;
  }

  function run() {
    if (busy || !sourceFile) return;
    var validated = toolkit.validateArgs({
      tokenizer: 'estimate',
      limit: parseInt(el.limit.value, 10)
    }, tool);
    if (!validated.ok) { setStatus(validated.errors.join(' '), 'error'); return; }

    busy = true;
    setStatus('Counting…');

    readAsText(sourceFile).then(function (text) {
      var pieces = piecesFrom(text, sourceFile.name);
      var counts = [];
      for (var i = 0; i < pieces.length; i++) counts.push(toolkit.estimateTokens(pieces[i]));
      render(analyze(pieces, validated.args.limit, toolkit.estimateTokens), counts);
      setStatus('Estimated in this tab. For exact BGE-M3 counts: thl tool tokenize ' +
        sourceFile.name, 'ok');
    }).catch(function (err) {
      setStatus(err.message || 'Counting failed.', 'error');
    }).then(function () {
      busy = false;
    });
  }

  function acceptFile(file) {
    if (!file) return;
    sourceFile = file;
    el.dropTitle.textContent = file.name;
    el.dropHint.textContent = /\.jsonl$/i.test(file.name)
      ? 'JSONL — each record will be counted separately'
      : Math.max(1, Math.round(file.size / 1024)) + ' KB';
    el.run.disabled = false;
    setStatus('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    el = {
      drop: document.getElementById('drop-zone'),
      dropTitle: document.getElementById('drop-title'),
      dropHint: document.getElementById('drop-hint'),
      pick: document.getElementById('pick-file'),
      file: document.getElementById('file-input'),
      limit: document.getElementById('opt-limit'),
      run: document.getElementById('tokenize-btn'),
      status: document.getElementById('tool-status'),
      result: document.getElementById('tool-result'),
      facts: document.getElementById('result-facts'),
      preview: document.getElementById('result-preview'),
      args: document.getElementById('tool-args')
    };

    if (!toolkit) { setStatus('The tool runtime failed to load.', 'error'); return; }

    toolkit.loadManifest().then(function (loaded) {
      manifest = loaded;
      tool = toolkit.findTool(manifest, 'tokenize');
      if (!tool) throw new Error('tokenize is missing from the tool spec.');

      var limit = tool.params.filter(function (p) { return p.name === 'limit'; })[0];
      el.limit.min = limit.min;
      el.limit.max = limit.max;
      el.limit.value = limit.default;

      if (el.args) toolkit.renderParamTable(tool, el.args);
      el.drop.classList.remove('is-disabled');
      setStatus('');
    }).catch(function (err) {
      setStatus(err.message || 'The tool spec failed to load.', 'error');
    });

    el.pick.addEventListener('click', function () { el.file.click(); });
    el.file.addEventListener('change', function () { acceptFile(el.file.files[0]); });
    el.run.addEventListener('click', run);

    ['dragenter', 'dragover'].forEach(function (name) {
      el.drop.addEventListener(name, function (event) {
        event.preventDefault();
        el.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      el.drop.addEventListener(name, function (event) {
        event.preventDefault();
        el.drop.classList.remove('is-over');
      });
    });
    el.drop.addEventListener('drop', function (event) {
      acceptFile(event.dataTransfer.files[0]);
    });
  });

})();
