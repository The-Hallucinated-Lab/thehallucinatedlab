/* ============================================================
   extract.js — page glue for extract.html.

   Turns a document into Markdown that keeps its structure. Headings stay
   headings and page boundaries stay marked, because the chunk tool
   splits on exactly those — flattening to plain text here would leave
   structure-aware chunking with nothing to be aware of.

   Three tiers, decided per file:

     native   txt, md, html, csv — no parser needed, so these work with
              nothing installed and nothing vendored.
     vendored pdf, docx — need a parser in assets/vendor. Absent until
              one is vendored; the tier reports itself as unavailable
              rather than pretending.
     bridge   everything else. If `thl serve` is running on loopback the
              page hands the file to the Python package, which reaches
              considerably more formats. If it is not, the page says so
              and points at the install line.

   The bridge is never load-bearing. Every native format works with the
   bridge absent, offline, with nothing installed — which is the property
   the Ollama integration lacked and was removed for.

   Failure model:
     - Spec fails to load -> drop zone stays disabled, panel says why.
     - Unsupported format -> named before the file is read, with the tier
       that would handle it and how to get it.
     - Bridge unreachable -> silently ignored for native formats; for
       bridge-only formats the status line explains the install.
     - Parser throws -> message lands in the status line, any previously
       extracted document stays downloadable.
   ============================================================ */
(function () {
  'use strict';

  var toolkit = window.THL && window.THL.toolkit;

  /* @pure-start — no DOM, no network, no module state. */

  /* Lowercased extension including the dot, or '' when there is none.
     Reads the LAST dot so "report.final.pdf" is a pdf, and drops any
     directory part so a path cannot smuggle one in. */
  function extensionOf(filename) {
    var base = String(filename || '').replace(/^.*[\\/]/, '');
    var dot = base.lastIndexOf('.');
    if (dot <= 0) return '';
    return base.slice(dot).toLowerCase();
  }

  /* Formats the page can parse with no parser at all. Deliberately not
     read from the manifest: the manifest describes what the TOOL can do
     across runtimes, this is what THIS page can do unaided. */
  var NATIVE = ['.txt', '.md', '.markdown', '.html', '.htm', '.csv'];

  function isNative(ext) {
    return NATIVE.indexOf(ext) !== -1;
  }

  /* What will actually happen to this file, and what to say if nothing
     will. Decided against the formats the bridge REPORTED, not the ones
     the manifest says Python can reach: a bridge running without the
     extract extra reads roughly what this tab reads, and routing a PDF
     to it would fail after the visitor had already chosen the file.

     Four outcomes, and the distinction between the last two matters —
     "install the package" is useless advice for a .zip. */
  function planFor(ext, meta, bridgeFormats) {
    if (!ext) {
      return { tier: 'none', ok: false,
        message: 'That file has no extension, so there is no way to tell what it is.' };
    }
    if (isNative(ext)) return { tier: 'native', ok: true, message: '' };

    if ((bridgeFormats || []).indexOf(ext) !== -1) {
      return { tier: 'bridge', ok: true, message: '' };
    }

    var python = ((meta && meta.tiers) || {}).python || [];
    if (python.indexOf(ext) !== -1) {
      return { tier: 'bridge', ok: false,
        message: ext + ' needs the local package. Install it with ' +
                 'pip install "thehallucinatedlab[extract]" and run: thl serve' };
    }
    return { tier: 'none', ok: false, message: 'Nothing here reads ' + ext + '.' };
  }

  /* YAML needs quoting for anything that could be read as structure.
     Rather than reason about which characters those are, quote every
     string and escape the two things that break a double-quoted YAML
     scalar. Numbers pass through bare so `pages: 42` stays an integer. */
  function yamlScalar(value) {
    if (typeof value === 'number' && isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    var text = String(value === null || value === undefined ? '' : value);
    return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function buildFrontmatter(meta) {
    var keys = ['source', 'format', 'pages', 'extracted', 'extractor'];
    var lines = ['---'];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (meta[key] === undefined || meta[key] === null || meta[key] === '') continue;
      lines.push(key + ': ' + yamlScalar(meta[key]));
    }
    lines.push('---');
    return lines.join('\n');
  }

  /* An HTML comment, because every Markdown renderer drops it and the
     chunk tool can still read it. A visible "Page 12" line would end up
     inside a chunk and then inside an embedding. */
  function pageMarker(n) {
    return '<!-- page: ' + n + ' -->';
  }

  /* Every split below keys on \n. A CRLF document would sail past
     /\n{2,}/ — there is a \r between the two newlines — and arrive at
     the chunker as one block the size of the whole file. Normalising
     here also keeps the output byte-identical to what Python writes. */
  function normalizeNewlines(text) {
    return String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n');
  }

  /* RFC4180-ish: quoted fields may contain commas, newlines and doubled
     quotes. Written out rather than split(',') because a CSV whose first
     column is an address breaks the naive version immediately. */
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var i = 0;
    var src = String(text || '').replace(/\r\n?/g, '\n');

    while (i < src.length) {
      var ch = src.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* A pipe inside a cell would end the cell. Escaping it is the only
     thing standing between a CSV of shell commands and a broken table. */
  function escapeCell(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .trim();
  }

  function csvToMarkdown(text) {
    var rows = parseCsv(text);
    if (!rows.length) return '';

    /* Ragged rows are common in exported CSVs. Pad to the widest row so
       the table stays well formed rather than silently losing columns. */
    var width = 0;
    var r, c;
    for (r = 0; r < rows.length; r++) width = Math.max(width, rows[r].length);
    if (!width) return '';

    var lines = [];
    for (r = 0; r < rows.length; r++) {
      var cells = [];
      for (c = 0; c < width; c++) cells.push(escapeCell(rows[r][c]));
      lines.push('| ' + cells.join(' | ') + ' |');
      if (r === 0) {
        var rule = [];
        for (c = 0; c < width; c++) rule.push('---');
        lines.push('| ' + rule.join(' | ') + ' |');
      }
    }
    return lines.join('\n');
  }

  /* Markdown -> something readable as plain text. Used only for
     format=text, and deliberately lossy: it strips the structure rather
     than pretending the result is still chunkable. */
  function markdownToText(markdown) {
    return String(markdown || '')
      .replace(/^---\n[\s\S]*?\n---\n?/, '')      // frontmatter
      .replace(/<!--[\s\S]*?-->/g, '')            // page markers
      /* [ \t] rather than \s throughout: under the m flag \s matches the
         newline too, so `^\s*[-*+]\s+` on "Title\n\n- one" eats the blank
         line as well as the bullet and silently welds two paragraphs
         together. */
      .replace(/^#{1,6}[ \t]+/gm, '')             // heading hashes
      .replace(/^[ \t]*\|.*\|[ \t]*$/gm, function (line) {
        return line.replace(/[ \t]*\|[ \t]*/g, '\t').replace(/^\t|\t$/g, '');
      })
      .replace(/^[ \t]*[-*+][ \t]+/gm, '')        // bullets
      .replace(/\*\*|__|`/g, '')                  // emphasis, code ticks
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* Assembles the final document. Kept separate from every parser so the
     frontmatter/page-marker/format options behave identically no matter
     which tier produced the blocks. */
  function assemble(blocks, meta, args) {
    var body = [];
    var lastPage = null;
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block || !String(block.text || '').trim()) continue;
      /* Only on change. A page of twenty paragraphs would otherwise
         carry twenty identical markers, which is noise in the file and
         twenty more things for the chunker to step over. */
      if (args.page_markers && block.page && block.page !== lastPage) {
        body.push(pageMarker(block.page));
        lastPage = block.page;
      }
      body.push(String(block.text).trim());
    }

    var markdown = body.join('\n\n');
    if (args.format === 'text') return markdownToText(markdown);
    if (args.frontmatter) return buildFrontmatter(meta) + '\n\n' + markdown + '\n';
    return markdown + '\n';
  }

  /* report.pdf -> report.md. Mirrors filenameFor in toolkit.js, but the
     extension depends on the format argument rather than an encoder. */
  /* Seconds, no milliseconds, Z suffix. toISOString() includes
     milliseconds and Python's strftime does not, so without this the two
     runtimes write visibly different frontmatter for the same document —
     the exact drift the shared fixtures exist to prevent, except the
     fixtures supply this field rather than generating it. */
  function timestamp(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function outputName(inputName, format) {
    var base = String(inputName || '').replace(/^.*[\\/]/, '');
    var dot = base.lastIndexOf('.');
    var stem = dot > 0 ? base.slice(0, dot) : base;
    stem = stem.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').trim();
    if (!stem) stem = 'extracted';
    return stem + (format === 'text' ? '.txt' : '.md');
  }

  /* @pure-end */

  /* ---- DOM glue ---- */

  var BRIDGE_ORIGINS = ['http://127.0.0.1:8787', 'http://localhost:8787'];
  var BRIDGE_TIMEOUT_MS = 1200;

  var manifest = null;
  var tool = null;
  var sourceFile = null;
  var downloadUrl = null;
  var bridge = null;          // resolved origin, or null when absent
  var bridgeFormats = [];     // what it reported it can actually read
  var busy = false;

  var el = {};

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.className = 'tool-status' + (kind ? ' is-' + kind : '');
  }

  /* Probes loopback once. A failure here is the normal case — most
     visitors will never have the package installed — so it must be
     quiet, quick, and must never block the native path. */
  function probeBridge() {
    var attempts = BRIDGE_ORIGINS.map(function (origin) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, BRIDGE_TIMEOUT_MS);
      return fetch(origin + '/thl/v1/capabilities', {
        signal: controller.signal,
        mode: 'cors'
      }).then(function (response) {
        clearTimeout(timer);
        if (!response.ok) throw new Error('bridge returned ' + response.status);
        return response.json();
      }).then(function (payload) {
        return { origin: origin, capabilities: payload };
      });
    });

    /* Promise.any resolves on the first success and rejects only when
       every origin fails, which is exactly the semantics wanted: try
       both spellings of loopback, take whichever answers. */
    return Promise.any(attempts).catch(function () { return null; });
  }

  function renderBridge(found) {
    bridge = found ? found.origin : null;
    bridgeFormats = found && found.capabilities && found.capabilities.formats
      ? found.capabilities.formats
      : [];
    if (!el.bridge) return;

    if (!found) {
      el.bridge.textContent = 'Running unaided. Text, Markdown, HTML and CSV work right here. ' +
        'For PDF, Word, slides and spreadsheets, install the package and run: thl serve';
      el.bridge.className = 'tool-bridge';
      return;
    }

    /* What the bridge ADDS, not what it has. A bridge whose extras are
       not installed reads roughly what this tab already reads, and
       announcing "7 formats available" would imply a PDF is welcome when
       the parser for it is missing. */
    var extra = bridgeFormats.filter(function (ext) { return !isNative(ext); });
    el.bridge.className = 'tool-bridge is-on';
    el.bridge.textContent = extra.length
      ? 'Local package detected — it adds ' + extra.join(', ') + '.'
      : 'Local package detected, but none of its document parsers are installed. ' +
        'For PDF, Word, slides and spreadsheets: pip install "thehallucinatedlab[extract]"';
  }

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.readAsText(file);
    });
  }

  /* DOMParser rather than innerHTML: the document is never attached to
     this page, so a <script> in the source cannot run and an <img
     onerror> has nothing to fire against. */
  function htmlToBlocks(html) {
    var parsed = new DOMParser().parseFromString(html, 'text/html');
    var root = parsed.body || parsed.documentElement;
    var blocks = [];

    var nodes = root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var tag = node.tagName.toLowerCase();
      var text = (node.textContent || '').trim();
      if (!text) continue;

      if (/^h[1-6]$/.test(tag)) {
        blocks.push({ text: new Array(Number(tag.charAt(1)) + 1).join('#') + ' ' + text });
      } else if (tag === 'li') {
        blocks.push({ text: '- ' + text });
      } else if (tag === 'pre') {
        blocks.push({ text: '```\n' + text + '\n```' });
      } else if (tag === 'blockquote') {
        blocks.push({ text: '> ' + text.replace(/\n/g, '\n> ') });
      } else if (tag === 'table') {
        blocks.push({ text: tableToMarkdown(node) });
      } else {
        blocks.push({ text: text });
      }
    }
    return blocks;
  }

  function tableToMarkdown(table) {
    var rows = table.querySelectorAll('tr');
    var lines = [];
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('th, td');
      var out = [];
      for (var c = 0; c < cells.length; c++) {
        out.push(escapeCell(cells[c].textContent));
      }
      if (!out.length) continue;
      lines.push('| ' + out.join(' | ') + ' |');
      if (r === 0) {
        var rule = [];
        for (var k = 0; k < out.length; k++) rule.push('---');
        lines.push('| ' + rule.join(' | ') + ' |');
      }
    }
    return lines.join('\n');
  }

  function blocksFor(ext, text) {
    if (ext === '.csv') return [{ text: csvToMarkdown(text) }];
    if (ext === '.html' || ext === '.htm') return htmlToBlocks(text);
    if (ext === '.md' || ext === '.markdown') return [{ text: text }];
    /* .txt — paragraphs on blank lines, so the chunker has something to
       work with even without headings. */
    return String(text).split(/\n{2,}/).map(function (part) {
      return { text: part.trim() };
    });
  }

  function runViaBridge(file, args) {
    var body = new FormData();
    body.append('file', file, file.name);
    Object.keys(args).forEach(function (key) { body.append(key, String(args[key])); });

    return fetch(bridge + '/thl/v1/run/extract', { method: 'POST', body: body, mode: 'cors' })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error(payload.error || ('bridge returned ' + response.status));
          return payload;
        });
      });
  }

  function currentArgs() {
    return {
      format: el.format ? el.format.value : 'markdown',
      frontmatter: el.frontmatter ? el.frontmatter.checked : true,
      page_markers: el.pageMarkers ? el.pageMarkers.checked : true,
      tables: el.tables ? el.tables.checked : true
    };
  }

  function offerDownload(text, name) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    downloadUrl = URL.createObjectURL(blob);
    el.download.href = downloadUrl;
    el.download.download = name;
    el.resultName.textContent = name;
    el.preview.textContent = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text;
    /* Built node by node rather than with innerHTML: the source filename
       is the visitor's own, but it is still the one string here that can
       carry markup, and "it is their own file" is not a property this
       code should have to depend on. */
    while (el.facts.firstChild) el.facts.removeChild(el.facts.firstChild);
    [['characters', text.length.toLocaleString()],
     ['lines', String(text.split('\n').length)],
     ['source', sourceFile.name]].forEach(function (pair) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = pair[0];
      li.appendChild(label);
      li.appendChild(document.createTextNode(' ' + pair[1]));
      el.facts.appendChild(li);
    });
    el.result.hidden = false;
  }

  function run() {
    if (busy || !sourceFile) return;
    var validated = toolkit.validateArgs(currentArgs(), tool);
    if (!validated.ok) { setStatus(validated.errors.join(' '), 'error'); return; }

    var ext = extensionOf(sourceFile.name);
    var plan = planFor(ext, tool.meta, bridgeFormats);
    busy = true;
    setStatus('Extracting…');

    var work;
    if (plan.tier === 'native') {
      work = readAsText(sourceFile).then(function (raw) {
        var blocks = blocksFor(ext, normalizeNewlines(raw));
        return assemble(blocks, {
          source: sourceFile.name,
          format: validated.args.format,
          extracted: timestamp(new Date()),
          extractor: 'browser-native'
        }, validated.args);
      });
    } else if (plan.ok) {
      work = runViaBridge(sourceFile, validated.args).then(function (payload) {
        return payload.text;
      });
    } else {
      busy = false;
      setStatus(plan.message, 'error');
      return;
    }

    work.then(function (text) {
      offerDownload(text, outputName(sourceFile.name, validated.args.format));
      setStatus('Done — ' + (plan.tier === 'native'
        ? 'parsed in this tab.'
        : 'parsed by the local package.'), 'ok');
    }).catch(function (err) {
      setStatus(err.message || 'Extraction failed.', 'error');
    }).then(function () {
      busy = false;
    });
  }

  function acceptFile(file) {
    if (!file) return;
    var max = (tool.input && tool.input.maxBytes) || Infinity;
    if (file.size > max) {
      setStatus('That file is ' + Math.round(file.size / 1048576) + 'MB. The limit is ' +
        Math.round(max / 1048576) + 'MB, because the whole file is held in memory while parsing.', 'error');
      return;
    }
    sourceFile = file;
    el.dropTitle.textContent = file.name;
    el.dropHint.textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB';
    el.run.disabled = false;

    /* Decided now rather than on the Extract click, so the visitor finds
       out the format is unreachable while they still have the file
       picker in mind — not after pressing the button. */
    var plan = planFor(extensionOf(file.name), tool.meta, bridgeFormats);
    setStatus(plan.message, plan.ok ? '' : 'error');
    el.run.disabled = !plan.ok;
  }

  document.addEventListener('DOMContentLoaded', function () {
    el = {
      drop: document.getElementById('drop-zone'),
      dropTitle: document.getElementById('drop-title'),
      dropHint: document.getElementById('drop-hint'),
      pick: document.getElementById('pick-file'),
      file: document.getElementById('file-input'),
      format: document.getElementById('opt-format'),
      frontmatter: document.getElementById('opt-frontmatter'),
      pageMarkers: document.getElementById('opt-page-markers'),
      tables: document.getElementById('opt-tables'),
      run: document.getElementById('extract-btn'),
      status: document.getElementById('tool-status'),
      result: document.getElementById('tool-result'),
      resultName: document.getElementById('result-name'),
      preview: document.getElementById('result-preview'),
      facts: document.getElementById('result-facts'),
      download: document.getElementById('result-download'),
      args: document.getElementById('tool-args'),
      bridge: document.getElementById('bridge-status')
    };

    if (!toolkit) { setStatus('The tool runtime failed to load.', 'error'); return; }

    toolkit.loadManifest().then(function (loaded) {
      manifest = loaded;
      tool = toolkit.findTool(manifest, 'extract');
      if (!tool) throw new Error('extract is missing from the tool spec.');

      var format = tool.params.filter(function (p) { return p.name === 'format'; })[0];
      format.values.forEach(function (value) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (value === format.default) option.selected = true;
        el.format.appendChild(option);
      });

      if (el.args) toolkit.renderParamTable(tool, el.args);
      el.drop.classList.remove('is-disabled');
      setStatus('');

      return probeBridge().then(renderBridge);
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
