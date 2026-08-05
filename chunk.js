/* ============================================================
   chunk.js — page glue for chunk.html.

   Splits a Markdown document into retrieval-sized pieces along its own
   structure. Headings decide where sections are; size only decides where
   a section has to be cut. That ordering is the entire reason extract
   goes to the trouble of preserving headings — a chunk is a part of the
   document, not a 512-token window that happens to land somewhere.

   Every chunk carries heading_path, page and source, because that is
   what turns a retrieved fragment into a citation rather than an
   anonymous paragraph.

   Token counting here is toolkit.estimateTokens, a heuristic, because
   running BGE-M3's real tokenizer would mean a ~17MB download in a page
   that budgets 40KB for its own script. Every record says so in its
   `tokenizer` field, and the Python side re-checks. The heuristic errs
   high on purpose: an under-count makes a chunk that overflows the
   model's context, and an oversized chunk is not rejected at embed time
   — it is silently truncated, and its tail never reaches the vector.

   The Python twin is thehallucinatedlab/tools/chunk.py, and both run
   spec/chunk-fixtures.json. If they drift, both suites go red.

   Failure model:
     - Spec fails to load -> drop zone stays disabled, panel says why.
     - overlap >= max_tokens -> refused before any work, because each
       chunk would repeat the whole of the one before it.
     - Nothing to chunk -> says so rather than writing an empty file.
   ============================================================ */
(function () {
  'use strict';

  var toolkit = window.THL && window.THL.toolkit;

  /* @pure-start — no DOM, no network, no module state. */

  var FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
  var PAGE_MARKER = /<!--\s*page:\s*(\d+)\s*-->/;
  var HEADING = /^(#{1,6})\s+(.*)$/;
  var FENCE = /^\s*```/;
  /* Deliberately simple. A full abbreviation list would be a lot of
     machinery for a boundary that only matters once a paragraph is
     already too big to keep whole. */
  var SENTENCE = /(?<=[.!?])\s+/;

  /* Only what extract writes: quoted strings and bare numbers, one per
     line. A general YAML parser would be a dependency for the sake of a
     header this project produced itself. */
  function parseFrontmatter(text) {
    var match = FRONTMATTER.exec(String(text || ''));
    if (!match) return { meta: {}, body: String(text || '') };

    var meta = {};
    var lines = match[1].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var at = lines[i].indexOf(':');
      if (at < 0) continue;
      var key = lines[i].slice(0, at).trim();
      var value = lines[i].slice(at + 1).trim();
      if (value.length >= 2 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
        meta[key] = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      } else if (/^-?\d+$/.test(value)) {
        meta[key] = parseInt(value, 10);
      } else if (value) {
        meta[key] = value;
      }
    }
    return { meta: meta, body: String(text).slice(match[0].length) };
  }

  /* Walks the document into blocks, each knowing the headings above it.

     Headings are not emitted as blocks: they become the path attached to
     everything beneath them. Emitting them too would put the heading in
     the output twice — once as the path, once as the first line of the
     chunk that follows it. */
  function parseBlocks(body) {
    var blocks = [];
    var stack = [];
    var page = null;
    var buffer = [];
    var fenced = false;

    function flush() {
      var text = buffer.join('\n').trim();
      buffer.length = 0;
      if (!text) return;
      var path = [];
      for (var i = 0; i < stack.length; i++) path.push(stack[i].title);
      blocks.push({ text: text, page: page, path: path });
    }

    var lines = String(body || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (FENCE.test(line)) {
        /* Inside a fence, blank lines and #-lines are code rather than
           structure; splitting on them would cut a snippet in half. */
        fenced = !fenced;
        buffer.push(line);
        continue;
      }
      if (fenced) { buffer.push(line); continue; }

      var marker = PAGE_MARKER.exec(line);
      if (marker && !line.replace(marker[0], '').trim()) {
        flush();
        page = parseInt(marker[1], 10);
        continue;
      }

      var heading = HEADING.exec(line);
      if (heading) {
        flush();
        var level = heading[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level: level, title: heading[2].trim() });
        continue;
      }

      if (!line.trim()) { flush(); continue; }
      buffer.push(line);
    }

    flush();
    return blocks;
  }

  function greedy(parts, joiner, budget, count) {
    var out = [];
    var current = '';
    for (var i = 0; i < parts.length; i++) {
      var candidate = current ? current + joiner + parts[i] : parts[i];
      if (current && count(candidate) > budget) {
        out.push(current);
        current = parts[i];
      } else {
        current = candidate;
      }
    }
    if (current) out.push(current);
    return out;
  }

  function nonEmpty(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) if (String(list[i]).trim()) out.push(list[i]);
    return out;
  }

  /* Cuts one oversized block on the coarsest boundary that still fits,
     so a paragraph is only broken into sentences when the paragraph
     alone is too big, and into words only when one sentence is. */
  function splitText(text, budget, count) {
    if (count(text) <= budget) return [text];

    var attempts = [
      { parts: String(text).split('\n\n'), joiner: '\n\n' },
      { parts: String(text).split(SENTENCE), joiner: ' ' },
      { parts: String(text).split(' '), joiner: ' ' }
    ];

    for (var a = 0; a < attempts.length; a++) {
      var usable = nonEmpty(attempts[a].parts);
      if (usable.length < 2) continue;
      var out = greedy(usable, attempts[a].joiner, budget, count);
      var allFit = true;
      for (var i = 0; i < out.length; i++) {
        if (count(out[i]) > budget) { allFit = false; break; }
      }
      if (allFit) return out;
    }

    /* One enormous unbroken run. Cut on characters rather than emit
       something that would be truncated invisibly at embed time. */
    var approx = Math.max(1, budget * 3);
    var pieces = [];
    for (var c = 0; c < text.length; c += approx) pieces.push(text.slice(c, c + approx));
    return pieces;
  }

  /* The last `budget` tokens' worth of text, on a word boundary. */
  function tail(text, budget, count) {
    if (budget <= 0) return '';
    var words = String(text).split(/\s+/);
    var kept = [];
    for (var i = words.length - 1; i >= 0; i--) {
      kept.unshift(words[i]);
      if (count(kept.join(' ')) >= budget) break;
    }
    return kept.join(' ');
  }

  /* Compared element by element rather than by joining on a separator.
     Any separator is a character a heading could legitimately contain,
     so ["A B"] and ["A", "B"] would compare equal and two unrelated
     sections would silently merge into one chunk. */
  function samePath(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function pack(blocks, options) {
    var count = options.count;
    var maxTokens = options.max_tokens;
    var chunks = [];

    /* Consecutive blocks sharing a heading path form a section, and a
       chunk never spans two. A piece that straddled a boundary could not
       name which heading it belonged to. */
    var sections = [];
    for (var b = 0; b < blocks.length; b++) {
      var last = sections[sections.length - 1];
      if (last && samePath(last.path, blocks[b].path)) {
        last.members.push(blocks[b]);
      } else {
        sections.push({ path: blocks[b].path.slice(), members: [blocks[b]] });
      }
    }

    function emit(prefix, path, body, page) {
      var trimmed = String(body || '').trim();
      if (!trimmed) return;
      var text = prefix + trimmed;
      chunks.push({
        text: text,
        source: options.source,
        heading_path: path.slice(),
        page: page === undefined ? null : page,
        chunk_index: chunks.length,
        token_count: count(text),
        tokenizer: options.tokenizer
      });
    }

    for (var s = 0; s < sections.length; s++) {
      var path = sections[s].path;
      var prefix = (options.heading_context && path.length) ? path.join(' > ') + '\n\n' : '';
      var budget = prefix ? maxTokens - count(prefix) : maxTokens;
      if (budget < 1) { prefix = ''; budget = maxTokens; }

      /* Flattened first, so every piece already fits and the loop below
         only has to decide where the boundaries fall. */
      var pieces = [];
      var members = sections[s].members;
      for (var m = 0; m < members.length; m++) {
        var parts = splitText(members[m].text, budget, count);
        for (var p = 0; p < parts.length; p++) {
          pieces.push({ text: parts[p], page: members[m].page });
        }
      }

      var current = '';
      var currentPage = null;

      for (var i = 0; i < pieces.length; i++) {
        var candidate = current ? current + '\n\n' + pieces[i].text : pieces[i].text;
        if (current && count(candidate) > budget) {
          emit(prefix, path, current, currentPage);
          var carry = tail(current, options.overlap, count);
          current = carry ? carry + '\n\n' + pieces[i].text : pieces[i].text;
          /* The carry was sized alone and the piece was checked alone;
             together they can exceed the budget. Drop the overlap rather
             than the guarantee. */
          if (count(current) > budget) current = pieces[i].text;
          currentPage = pieces[i].page;
        } else {
          current = candidate;
          if (currentPage === null) currentPage = pieces[i].page;
        }
      }
      emit(prefix, path, current, currentPage);
    }

    return chunks;
  }

  function toJsonl(chunks) {
    var lines = [];
    for (var i = 0; i < chunks.length; i++) lines.push(JSON.stringify(chunks[i]));
    return lines.length ? lines.join('\n') + '\n' : '';
  }

  /* The manifest can express each bound but not the relationship between
     two. An overlap at least as large as the chunk means every chunk
     begins with the whole of the previous one. */
  function overlapProblem(args) {
    if (args.overlap >= args.max_tokens) {
      return 'overlap (' + args.overlap + ') must be smaller than max_tokens (' +
             args.max_tokens + '); otherwise every chunk would repeat the whole of ' +
             'the one before it.';
    }
    return null;
  }

  function outputName(inputName) {
    var base = String(inputName || '').replace(/^.*[\\/]/, '');
    var dot = base.lastIndexOf('.');
    var stem = dot > 0 ? base.slice(0, dot) : base;
    stem = stem.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').trim();
    if (!stem) stem = 'chunks';
    return stem + '.jsonl';
  }

  /* @pure-end */

  /* ---- DOM glue ---- */

  var manifest = null;
  var tool = null;
  var sourceFile = null;
  var downloadUrl = null;
  var busy = false;
  var el = {};

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.className = 'tool-status' + (kind ? ' is-' + kind : '');
  }

  function currentArgs() {
    return {
      max_tokens: parseInt(el.maxTokens.value, 10),
      overlap: parseInt(el.overlap.value, 10),
      tokenizer: 'estimate',
      heading_context: el.headingContext.checked
    };
  }

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.readAsText(file);
    });
  }

  function describe(chunks) {
    var counts = [];
    for (var i = 0; i < chunks.length; i++) counts.push(chunks[i].token_count);
    counts.sort(function (a, b) { return a - b; });
    var total = 0;
    for (var j = 0; j < counts.length; j++) total += counts[j];
    return {
      pieces: counts.length,
      total: total,
      median: counts.length ? counts[Math.floor(counts.length / 2)] : 0,
      largest: counts.length ? counts[counts.length - 1] : 0
    };
  }

  function offerDownload(jsonl, chunks, name) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([jsonl], { type: 'application/jsonl' }));
    el.download.href = downloadUrl;
    el.download.download = name;
    el.resultName.textContent = name;

    var stats = describe(chunks);
    while (el.facts.firstChild) el.facts.removeChild(el.facts.firstChild);
    [['chunks', String(stats.pieces)],
     ['tokens', stats.total.toLocaleString() + ' (estimated)'],
     ['median', String(stats.median)],
     ['largest', String(stats.largest)]].forEach(function (pair) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = pair[0];
      li.appendChild(label);
      li.appendChild(document.createTextNode(' ' + pair[1]));
      el.facts.appendChild(li);
    });

    /* First three records, pretty-printed. The file itself is one record
       per line; this is only so the shape is visible before download. */
    el.preview.textContent = chunks.slice(0, 3)
      .map(function (c) { return JSON.stringify(c, null, 2); })
      .join('\n\n') + (chunks.length > 3 ? '\n\n…' : '');
    el.result.hidden = false;
  }

  function run() {
    if (busy || !sourceFile) return;
    var validated = toolkit.validateArgs(currentArgs(), tool);
    if (!validated.ok) { setStatus(validated.errors.join(' '), 'error'); return; }

    var problem = overlapProblem(validated.args);
    if (problem) { setStatus(problem, 'error'); return; }

    busy = true;
    setStatus('Chunking…');

    readAsText(sourceFile).then(function (raw) {
      var text = String(raw).replace(/\r\n?/g, '\n');
      var parsed = parseFrontmatter(text);
      var blocks = parseBlocks(parsed.body);
      var chunks = pack(blocks, {
        max_tokens: validated.args.max_tokens,
        overlap: validated.args.overlap,
        heading_context: validated.args.heading_context,
        count: toolkit.estimateTokens,
        tokenizer: 'estimate',
        source: parsed.meta.source || sourceFile.name
      });

      if (!chunks.length) {
        setStatus('Nothing to chunk — the document had no body text.', 'error');
        return;
      }

      offerDownload(toJsonl(chunks), chunks, outputName(sourceFile.name));
      var headed = false;
      for (var i = 0; i < blocks.length; i++) if (blocks[i].path.length) { headed = true; break; }
      setStatus(headed
        ? 'Done — ' + chunks.length + ' chunks, sized by estimate. Re-check with thl for exact counts.'
        : 'Done — but no headings were found, so this fell back to size alone.', headed ? 'ok' : '');
    }).catch(function (err) {
      setStatus(err.message || 'Chunking failed.', 'error');
    }).then(function () {
      busy = false;
    });
  }

  function acceptFile(file) {
    if (!file) return;
    var max = (tool.input && tool.input.maxBytes) || Infinity;
    if (file.size > max) {
      setStatus('That file is ' + Math.round(file.size / 1048576) + 'MB; the limit is ' +
        Math.round(max / 1048576) + 'MB.', 'error');
      return;
    }
    sourceFile = file;
    el.dropTitle.textContent = file.name;
    el.dropHint.textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB';
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
      maxTokens: document.getElementById('opt-max-tokens'),
      maxTokensValue: document.getElementById('max-tokens-value'),
      overlap: document.getElementById('opt-overlap'),
      overlapValue: document.getElementById('overlap-value'),
      headingContext: document.getElementById('opt-heading-context'),
      run: document.getElementById('chunk-btn'),
      status: document.getElementById('tool-status'),
      result: document.getElementById('tool-result'),
      resultName: document.getElementById('result-name'),
      preview: document.getElementById('result-preview'),
      facts: document.getElementById('result-facts'),
      download: document.getElementById('result-download'),
      args: document.getElementById('tool-args')
    };

    if (!toolkit) { setStatus('The tool runtime failed to load.', 'error'); return; }

    toolkit.loadManifest().then(function (loaded) {
      manifest = loaded;
      tool = toolkit.findTool(manifest, 'chunk');
      if (!tool) throw new Error('chunk is missing from the tool spec.');

      /* Ranges built from the manifest rather than the markup, so the
         page cannot offer a size the tool would reject. */
      tool.params.forEach(function (param) {
        var input = param.name === 'max_tokens' ? el.maxTokens
                  : param.name === 'overlap' ? el.overlap : null;
        if (!input) return;
        input.min = param.min;
        input.max = param.max;
        input.value = param.default;
      });
      el.maxTokensValue.textContent = el.maxTokens.value;
      el.overlapValue.textContent = el.overlap.value;

      if (el.args) toolkit.renderParamTable(tool, el.args);
      el.drop.classList.remove('is-disabled');
      setStatus('');
    }).catch(function (err) {
      setStatus(err.message || 'The tool spec failed to load.', 'error');
    });

    el.pick.addEventListener('click', function () { el.file.click(); });
    el.file.addEventListener('change', function () { acceptFile(el.file.files[0]); });
    el.run.addEventListener('click', run);
    el.maxTokens.addEventListener('input', function () {
      el.maxTokensValue.textContent = el.maxTokens.value;
    });
    el.overlap.addEventListener('input', function () {
      el.overlapValue.textContent = el.overlap.value;
    });

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
