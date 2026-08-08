/* ============================================================
   toolkit.js — the shared THL tool runtime for the browser.

   Loads spec/manifest.json, validates arguments against it, runs the
   tool, and renders the argument reference table straight from the same
   spec. The page, the Assistant and the Python package therefore agree
   on what an argument is called and what it accepts, because all three
   read one file.

   Conversion happens on a canvas in the visitor's own tab. Nothing is
   uploaded, there is no endpoint to call, and the whole thing keeps
   working with the network off — which is the entire reason this tool
   did not need the backend it looked like it needed.

   Failure model:
     - Manifest missing or malformed -> loadManifest rejects; the page
       shows a broken-tool notice rather than a dead drop zone.
     - Argument out of range -> validateArgs collects every problem and
       returns them together, so one bad field does not hide the rest.
     - Browser cannot encode the requested format -> canvas.toBlob
       silently hands back a PNG. probeEncoders() finds this up front and
       runImageConvert re-checks after encoding, so nobody ever gets a
       file whose extension lies about its contents.
   ============================================================ */
(function () {
  'use strict';

  var MANIFEST_URL = 'spec/manifest.json';
  var MANIFEST_TIMEOUT_MS = 8000;

  var manifestPromise = null;
  var encoderSupport = null;

  /* @pure-start — no DOM, no network, no module state. */

  function ToolError(message) {
    var err = new Error(message);
    err.name = 'ToolError';
    return err;
  }

  function findTool(manifest, name) {
    var tools = (manifest && manifest.tools) || [];
    for (var i = 0; i < tools.length; i++) {
      if (tools[i].name === name) return tools[i];
    }
    return null;
  }

  function enumVocabulary(param) {
    var vocab = {};
    var values = param.values || [];
    for (var i = 0; i < values.length; i++) vocab[values[i]] = values[i];
    var aliases = param.aliases || {};
    for (var key in aliases) {
      if (Object.prototype.hasOwnProperty.call(aliases, key)) vocab[key] = aliases[key];
    }
    return vocab;
  }

  function normalizeHex(value) {
    var text = String(value).trim().toLowerCase();
    var short = /^#([0-9a-f]{3})$/.exec(text);
    if (short) {
      return '#' + short[1].charAt(0) + short[1].charAt(0) +
                   short[1].charAt(1) + short[1].charAt(1) +
                   short[1].charAt(2) + short[1].charAt(2);
    }
    var full = /^#([0-9a-f]{6})$/.exec(text);
    return full ? '#' + full[1] : null;
  }

  function isBlank(value) {
    return value === undefined || value === null || value === '';
  }

  /* What a form control or a parsed utterance actually hands over for a
     boolean: a real bool from a checkbox, a string from a select or a
     query param. Returns null when it is none of them, so the caller can
     report the problem rather than silently reading it as false. */
  function normalizeBool(value) {
    if (typeof value === 'boolean') return value;
    var text = String(value).trim().toLowerCase();
    if (text === 'true' || text === 'yes' || text === 'on' || text === '1') return true;
    if (text === 'false' || text === 'no' || text === 'off' || text === '0') return false;
    return null;
  }

  /* ---- Token estimation ----

     The browser cannot run BGE-M3's tokenizer without downloading a
     ~17MB vocabulary, which is out of proportion to a page that budgets
     40KB for its own script. So chunking in the browser sizes against
     this heuristic and records that it did; the Python side re-checks
     with the real tokenizer.

     It errs HIGH on purpose. An under-count produces a chunk that
     exceeds the embedding model's context, and an oversized chunk is not
     rejected at embed time - it is silently truncated, and the tail
     never reaches the vector. Over-counting only costs slightly smaller
     chunks, which is the cheap direction to be wrong in.

     Mirrors estimate_tokens() in tools/tokenize.py exactly, including
     the integer arithmetic: a float ceil(total * 1.15) rounds
     differently in the two languages at some magnitudes. */

  /* Scripts that do not use spaces. SentencePiece rarely merges these
     below one piece per glyph and frequently produces more. All BMP, so
     no surrogate handling is needed. */
  var DENSE = '぀-ヿ㐀-䶿一-鿿가-힯';
  var LATIN = 'A-Za-zÀ-ɏ';
  /* Double-escaped on purpose: this is a STRING being handed to RegExp,
     and '\d' in a JS string literal is just 'd'. Written singly it
     silently compiles to /d+/ and stops counting digits at all. */
  var PIECE = new RegExp(
    '[' + DENSE + ']|[' + LATIN + ']+|\\d+|[^\\s' + LATIN + '0-9' + DENSE + ']', 'g');
  var LATIN_ONLY = new RegExp('^[' + LATIN + ']+$');

  function estimateTokens(text) {
    var body = String(text === null || text === undefined ? '' : text);
    if (!body.trim()) return 0;

    var pieces = body.match(PIECE) || [];
    var total = 0;
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (LATIN_ONLY.test(piece)) {
        total += Math.max(1, Math.ceil(piece.length / 4));
      } else if (/^\d+$/.test(piece)) {
        /* Digits fragment far more than letters - most vocabularies
           carry only short numeric pieces. */
        total += Math.max(1, Math.ceil(piece.length / 2));
      } else {
        total += 1;
      }
    }
    return Math.floor((total * 115 + 99) / 100);
  }

  /* One checker per parameter type, looked up rather than chained
     through an if/else ladder. Each returns {value} or {error}, so
     validateArgs stays a loop over parameters and adding a type means
     adding an entry here rather than another branch in the middle of
     the loop.

     Bounds come from the manifest, never from constants restated here -
     that is what keeps the browser and the Python package agreeing. */
  var CHECKERS = {
    enum: function (param, value) {
      var vocab = enumVocabulary(param);
      var key = String(value).trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(vocab, key)) return { value: vocab[key] };
      return { error: param.name + ' must be one of ' + (param.values || []).join(', ') + '.' };
    },

    integer: function (param, value) {
      var num = Number(value);
      if (!isFinite(num) || Math.floor(num) !== num) {
        return { error: param.name + ' must be a whole number.' };
      }
      var under = param.min !== undefined && num < param.min;
      var over = param.max !== undefined && num > param.max;
      if (under || over) {
        return { error: param.name + ' must be between ' + param.min + ' and ' + param.max + '.' };
      }
      return { value: num };
    },

    color: function (param, value) {
      var hex = normalizeHex(value);
      if (hex) return { value: hex };
      return { error: param.name + ' must be a hex colour such as #ffffff.' };
    },

    number: function (param, value) {
      var real = Number(value);
      if (!isFinite(real)) return { error: param.name + ' must be a number.' };
      var under = param.min !== undefined && real < param.min;
      var over = param.max !== undefined && real > param.max;
      if (under || over) {
        return { error: param.name + ' must be between ' + param.min + ' and ' + param.max + '.' };
      }
      return { value: real };
    },

    boolean: function (param, value) {
      var flag = normalizeBool(value);
      if (flag === null) return { error: param.name + ' must be true or false.' };
      return { value: flag };
    },

    string: function (param, value) {
      var text = String(value).trim();
      if (!text) return { error: param.name + ' must not be empty.' };
      if (param.maxLength !== undefined && text.length > param.maxLength) {
        return { error: param.name + ' must be at most ' + param.maxLength + ' characters.' };
      }
      /* Anchored, or a pattern meant to describe the whole value would
         pass on any string merely containing a match. */
      if (param.pattern !== undefined &&
          !new RegExp('^(?:' + param.pattern + ')$').test(text)) {
        return { error: param.name + ' must match ' + param.pattern + '.' };
      }
      return { value: text };
    },

    /* A command line hands over "a,b,c" and a caller hands over an array.
       Both mean the same thing, so both are accepted and normalised here
       rather than at every call site. */
    list: function (param, value) {
      var items;
      if (Array.isArray(value)) {
        items = value.map(function (item) { return String(item).trim(); });
      } else {
        items = String(value).split(',').map(function (item) { return item.trim(); });
      }
      items = items.filter(function (item) { return item !== ''; });
      if (!items.length) return { error: param.name + ' must name at least one value.' };
      return { value: items };
    },

    /* Same shape for key=value pairs: --types zip=categorical_high from a
       shell, a real object from Python. A pair with no '=' is a mistake
       worth reporting, not a key with an empty value. */
    mapping: function (param, value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { value: value };
      }
      var out = {};
      var pairs = String(value).split(',');
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].trim();
        if (!pair) continue;
        var at = pair.indexOf('=');
        if (at < 1) return { error: param.name + ' takes key=value pairs; got "' + pair + '".' };
        out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
      }
      if (!Object.keys(out).length) {
        return { error: param.name + ' must name at least one key=value pair.' };
      }
      return { value: out };
    },
  };

  /* A path is a string as far as the browser is concerned -- it never
     touches a file system, it hands a File object to the tool. Aliased
     rather than duplicated so the two cannot drift. */
  CHECKERS.path = CHECKERS.string;

  /* An unrecognised type is passed through rather than rejected. The
     manifest is ours, so a new type here means the spec moved ahead of
     this file - failing closed would break the page on a spec change
     that the Python package already handles. */
  function checkParam(param, value) {
    var checker = CHECKERS[param.type];
    return checker ? checker(param, value) : { value: value };
  }

  /* Collects every problem rather than throwing on the first one: a form
     that reports "format is required" and then, after you fix it,
     "quality must be between 1 and 100" wastes a round trip per field. */
  function validateArgs(rawArgs, tool) {
    var input = rawArgs || {};
    var params = (tool && tool.params) || [];
    var args = {};
    var errors = [];
    var known = {};
    var i;

    for (i = 0; i < params.length; i++) {
      var param = params[i];
      known[param.name] = true;
      var value = input[param.name];

      if (isBlank(value)) {
        if (param.required) {
          errors.push(param.name + ' is required.');
        } else if (param.default !== undefined) {
          args[param.name] = param.default;
        }
        continue;
      }

      var checked = checkParam(param, value);
      if (checked.error) errors.push(checked.error);
      else args[param.name] = checked.value;
    }

    for (var name in input) {
      if (!Object.prototype.hasOwnProperty.call(input, name)) continue;
      if (!known[name] && !isBlank(input[name])) {
        errors.push('unknown argument "' + name + '".');
      }
    }

    return { ok: errors.length === 0, args: args, errors: errors };
  }

  /* photo.jpeg + png -> photo.png. Drops any directory part and the
     characters a download filename must not carry, and falls back to a
     fixed stem rather than emitting a bare ".png" for input like
     ".gitignore" or "". */
  function filenameFor(inputName, extension) {
    var base = String(inputName || '').replace(/^.*[\\/]/, '');
    var dot = base.lastIndexOf('.');
    var stem = dot > 0 ? base.slice(0, dot) : base;
    stem = stem.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').trim();
    if (!stem) stem = 'converted';
    return stem + '.' + extension;
  }

  function formatBytes(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* Percentage change in file size, negative meaning smaller. Reported
     next to the result because "did this actually help" is the only
     question anyone has after converting an image. */
  function sizeDelta(before, after) {
    if (!before || before <= 0) return null;
    return Math.round(((after - before) / before) * 100);
  }

  /* The row model behind the argument table on the page. Kept pure so a
     test can assert the docs stay in step with the manifest rather than
     going stale in hand-written HTML. */
  /* Where a tool can actually execute.

     The spec has said this since embed and index arrived, and nothing
     read it: the Assistant lists every tool under "here is what I can
     run, right here in the page" and then takes a file attachment before
     failing. Offering something the browser cannot do is worse than not
     recognising the request, because the visitor only finds out after
     doing work.

     A tool with no runtimes declared is treated as browser work, because
     every tool written before the field existed was. */
  function runsIn(tool, runtime) {
    var runtimes = (tool && tool.runtimes) || ['browser'];
    for (var i = 0; i < runtimes.length; i++) {
      if (runtimes[i] === runtime) return true;
    }
    return false;
  }

  /* ---- What this bundle can actually execute ----

     runsIn() reports what the SPEC claims: convert, extract, chunk and
     tokenize all say "browser". canRun() reports what this file has an
     implementation for, which is a smaller set — the other three are
     implemented by their own page scripts, not here.

     The two must not be conflated. The command builder offers to run a
     tool only when canRun() says yes, because a Run button that
     produces "Unknown tool" is worse than no Run button. */
  var BROWSER_RUNNERS = ['convert'];

  function canRun(name) {
    return BROWSER_RUNNERS.indexOf(normalizeToolName(name)) !== -1;
  }

  /* Names kept alive after a rename. Data rather than a branch, so a
     test can read the whole set and check each target is real. */
  var LEGACY_TOOL_NAMES = { converter: 'convert', image_convert: 'convert' };

  function normalizeToolName(name) {
    var key = String(name === null || name === undefined ? '' : name).trim();
    return Object.prototype.hasOwnProperty.call(LEGACY_TOOL_NAMES, key)
      ? LEGACY_TOOL_NAMES[key]
      : key;
  }

  /* ---- Presenting a result ----

     What a result IS belongs to the runtime that produced it, so the
     command builder can render a transcript without knowing that this
     particular tool deals in images.

     `line` is the one that matters: it is what `thl tool convert` prints
     to a terminal, character for character. ConvertResult.__str__ in
     tools/convert.py is
         f"{self.format} {self.width}x{self.height} -> {where}"
     and a test holds the two together. A page that shows a transcript
     the CLI would not print is a page that lies in the most convincing
     way available to it.

     Pure: the caller passes the object URL, because minting one is not
     this function's business and cannot be tested without a DOM. */
  function describeConvertResult(result, url) {
    if (!result) return null;
    var facts = [result.width + ' × ' + result.height, formatBytes(result.bytes)];

    if (result.delta !== null && result.delta !== undefined && result.sourceBytes) {
      if (result.delta === 0) {
        facts.push('same size as the original');
      } else {
        facts.push(Math.abs(result.delta) + '% ' +
          (result.delta < 0 ? 'smaller' : 'larger') + ' than ' + formatBytes(result.sourceBytes));
      }
    }

    return {
      line: result.format + ' ' + result.width + 'x' + result.height + ' -> ' + result.filename,
      image: {
        url: url,
        width: result.width,
        height: result.height,
        alt: result.filename + ', the converted image'
      },
      facts: facts,
      download: { url: url, filename: result.filename }
    };
  }

  var PRESENTERS = { convert: describeConvertResult };

  function presentResult(name, result, url) {
    var presenter = PRESENTERS[normalizeToolName(name)];
    return presenter ? presenter(result, url) : null;
  }

  function describeParams(tool) {
    var params = (tool && tool.params) || [];
    var rows = [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var type = p.type;
      if (p.type === 'enum') type = (p.values || []).join(' | ');
      else if (p.type === 'integer' && p.min !== undefined) type = 'int ' + p.min + '-' + p.max;
      else if (p.type === 'color') type = 'hex colour';
      else if (p.type === 'number' && p.min !== undefined) type = 'number ' + p.min + '-' + p.max;
      else if (p.type === 'boolean') type = 'true | false';
      else if (p.type === 'path') type = 'file path';
      else if (p.type === 'list') type = 'comma-separated list';
      else if (p.type === 'mapping') type = 'key=value pairs';

      /* null is a real default meaning "work it out from the input" - a
         sniffed delimiter, an output directory derived from the source
         path. It has to read differently from "-", which means the
         parameter has no default at all. */
      var fallback;
      if (p.required) fallback = 'required';
      else if (p.default === undefined) fallback = '-';
      else if (p.default === null) fallback = 'detected';
      else fallback = String(p.default);

      rows.push({
        name: p.name,
        type: type,
        required: !!p.required,
        fallback: fallback,
        description: p.description || ''
      });
    }
    return rows;
  }

  /* @pure-end */

  /* ---- Manifest ---- */

  /* Cached on the promise, not the value, so ten widgets asking at once
     share one request instead of racing. */
  function loadManifest() {
    if (manifestPromise) return manifestPromise;

    manifestPromise = fetch(MANIFEST_URL, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS)
    }).then(function (res) {
      if (!res.ok) throw ToolError('Could not load the tool spec (' + res.status + ').');
      return res.json();
    }).then(function (manifest) {
      if (!manifest || !manifest.tools || !manifest.tools.length) {
        throw ToolError('The tool spec is empty or malformed.');
      }
      return manifest;
    }).catch(function (err) {
      /* Do not cache a failure - a visitor who was offline for one
         request should get a real retry, not a poisoned promise. */
      manifestPromise = null;
      throw err;
    });

    return manifestPromise;
  }

  /* ---- Encoder support ----
     canvas.toBlob does not reject for a format it cannot encode: it
     quietly returns a PNG. Without this probe the page would offer AVIF
     everywhere and hand back mislabelled files on the browsers that
     cannot do it. */
  function probeEncoder(mime) {
    return new Promise(function (resolve) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvas.toBlob(function (blob) {
          resolve(!!blob && blob.type === mime);
        }, mime, 0.9);
      } catch (e) {
        resolve(false);
      }
    });
  }

  function probeEncoders(tool) {
    if (encoderSupport) return Promise.resolve(encoderSupport);

    var formats = (tool.meta && tool.meta.formats) || {};
    var names = Object.keys(formats);
    return Promise.all(names.map(function (name) {
      return probeEncoder(formats[name].mime);
    })).then(function (results) {
      var support = {};
      for (var i = 0; i < names.length; i++) support[names[i]] = results[i];
      /* PNG is mandatory in every canvas implementation; if the probe
         says otherwise the probe is wrong, not the browser. */
      support.png = true;
      encoderSupport = support;
      return support;
    });
  }

  /* ---- Decode ---- */
  function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).catch(function () {
        return decodeViaElement(file);
      });
    }
    return decodeViaElement(file);
  }

  function decodeViaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(ToolError('That file could not be read as an image.'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(ToolError('The browser failed to encode the image.'));
      }, mime, quality);
    });
  }

  /* ---- convert ---- */
  function runImageConvert(file, rawArgs, manifest) {
    var tool = findTool(manifest, 'convert');
    if (!tool) return Promise.reject(ToolError('convert is not in the tool spec.'));
    if (!file) return Promise.reject(ToolError('Choose an image first.'));

    var checked = validateArgs(rawArgs, tool);
    if (!checked.ok) return Promise.reject(ToolError(checked.errors.join(' ')));

    var args = checked.args;
    var spec = tool.meta.formats[args.format];
    var maxPixels = (tool.input && tool.input.maxPixels) || Infinity;
    var source = null;

    return decodeImage(file).then(function (bitmap) {
      source = bitmap;
      var width = bitmap.width;
      var height = bitmap.height;

      if (!width || !height) throw ToolError('That image has no dimensions the browser can read.');
      if (width * height > maxPixels) {
        throw ToolError('That image is ' + Math.round(width * height / 1e6) +
          ' megapixels, over the ' + Math.round(maxPixels / 1e6) +
          ' megapixel limit for in-browser conversion.');
      }

      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (!ctx) throw ToolError('This browser did not provide a 2D canvas context.');

      /* Without this, a transparent PNG converted to JPEG comes out with
         black where the transparency was, because the canvas starts
         fully transparent and JPEG has nowhere to put an alpha channel. */
      if (!spec.alpha) {
        ctx.fillStyle = args.background;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(source, 0, 0);

      var quality = spec.lossy ? args.quality / 100 : undefined;
      return canvasToBlob(canvas, spec.mime, quality).then(function (blob) {
        /* The probe runs before the UI offers a format, but re-check
           here: this is the assertion that a file called .avif really is
           one. */
        if (blob.type !== spec.mime) {
          throw ToolError('This browser cannot encode ' + args.format.toUpperCase() +
            '. Try PNG, JPEG or WebP.');
        }
        return {
          blob: blob,
          filename: filenameFor(file.name, spec.ext),
          format: args.format,
          width: width,
          height: height,
          bytes: blob.size,
          sourceBytes: file.size,
          delta: sizeDelta(file.size, blob.size),
          args: args
        };
      });
    }).then(function (result) {
      if (source && typeof source.close === 'function') source.close();
      return result;
    }, function (err) {
      if (source && typeof source.close === 'function') source.close();
      throw err;
    });
  }

  /* The legacy names are resolved by normalizeToolName rather than by an
     extra branch here, for the same reason the CLI keeps its alias: a
     script someone already wrote should not break because the tool got a
     better name. */
  function run(name, file, args, manifest) {
    if (normalizeToolName(name) === 'convert') {
      return runImageConvert(file, args, manifest);
    }
    return Promise.reject(ToolError('Unknown tool "' + name + '".'));
  }

  /* ---- Argument reference table ----
     Built from the manifest so the documented arguments cannot drift
     from the ones the code accepts. textContent throughout: the manifest
     is ours, but there is no reason for this to be the one place on the
     site that trusts a fetched file with innerHTML. */
  function renderParamTable(tool, container) {
    if (!container) return;
    container.textContent = '';

    var table = document.createElement('table');
    table.className = 'tool-args';

    var head = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Argument', 'Accepts', 'Default', 'What it does'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement('tbody');
    describeParams(tool).forEach(function (row) {
      var tr = document.createElement('tr');

      var nameCell = document.createElement('td');
      var code = document.createElement('code');
      code.textContent = row.name;
      nameCell.appendChild(code);
      if (row.required) {
        var badge = document.createElement('span');
        badge.className = 'tool-arg-required';
        badge.textContent = 'required';
        nameCell.appendChild(badge);
      }
      tr.appendChild(nameCell);

      [row.type, row.fallback, row.description].forEach(function (text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      body.appendChild(tr);
    });

    table.appendChild(body);
    container.appendChild(table);
  }

  /* Argument tables on pages that have no script of their own.

     A python-only tool (embed, index) has nothing to run in the browser,
     so its page ships no page script - and without this, its Arguments
     section would render as an empty div. Hard-coding the table would
     work and would also be the one thing this project exists to avoid:
     it would drift from the manifest the moment an argument changed.

     So any container carrying data-tool renders itself from the spec.
     Pages with their own script use an id instead and are untouched. */
  document.addEventListener('DOMContentLoaded', function () {
    var targets = document.querySelectorAll('[data-tool]');
    if (!targets.length) return;
    loadManifest().then(function (manifest) {
      for (var i = 0; i < targets.length; i++) {
        var tool = findTool(manifest, targets[i].getAttribute('data-tool'));
        if (tool) renderParamTable(tool, targets[i]);
      }
    }).catch(function () {
      /* The rest of the page is prose and still reads without it. */
    });
  });

  window.THL = window.THL || {};
  window.THL.toolkit = {
    loadManifest: loadManifest,
    findTool: findTool,
    validateArgs: validateArgs,
    estimateTokens: estimateTokens,
    probeEncoders: probeEncoders,
    run: run,
    runImageConvert: runImageConvert,
    renderParamTable: renderParamTable,
    describeParams: describeParams,
    runsIn: runsIn,
    canRun: canRun,
    normalizeToolName: normalizeToolName,
    presentResult: presentResult,
    filenameFor: filenameFor,
    formatBytes: formatBytes,
    sizeDelta: sizeDelta
  };

})();
