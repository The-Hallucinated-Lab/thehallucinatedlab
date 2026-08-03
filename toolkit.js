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

  /* Collects every problem rather than throwing on the first one: a form
     that reports "format is required" and then, after you fix it,
     "quality must be between 1 and 100" wastes a round trip per field.

     Bounds live in the manifest, so the browser and Python enforce the
     same numbers without either restating them. */
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

      if (param.type === 'enum') {
        var vocab = enumVocabulary(param);
        var key = String(value).trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(vocab, key)) {
          args[param.name] = vocab[key];
        } else {
          errors.push(param.name + ' must be one of ' + (param.values || []).join(', ') + '.');
        }

      } else if (param.type === 'integer') {
        var num = Number(value);
        if (!isFinite(num) || Math.floor(num) !== num) {
          errors.push(param.name + ' must be a whole number.');
        } else if (param.min !== undefined && num < param.min) {
          errors.push(param.name + ' must be between ' + param.min + ' and ' + param.max + '.');
        } else if (param.max !== undefined && num > param.max) {
          errors.push(param.name + ' must be between ' + param.min + ' and ' + param.max + '.');
        } else {
          args[param.name] = num;
        }

      } else if (param.type === 'color') {
        var hex = normalizeHex(value);
        if (hex) args[param.name] = hex;
        else errors.push(param.name + ' must be a hex colour such as #ffffff.');

      } else {
        args[param.name] = value;
      }
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
  function describeParams(tool) {
    var params = (tool && tool.params) || [];
    var rows = [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var type = p.type;
      if (p.type === 'enum') type = (p.values || []).join(' | ');
      else if (p.type === 'integer' && p.min !== undefined) type = 'int ' + p.min + '-' + p.max;
      else if (p.type === 'color') type = 'hex colour';

      rows.push({
        name: p.name,
        type: type,
        required: !!p.required,
        fallback: p.required ? 'required' : (p.default === undefined ? '-' : String(p.default)),
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

  /* ---- converter ---- */
  function runImageConvert(file, rawArgs, manifest) {
    var tool = findTool(manifest, 'converter');
    if (!tool) return Promise.reject(ToolError('converter is not in the tool spec.'));
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

  function run(name, file, args, manifest) {
    if (name === 'converter') return runImageConvert(file, args, manifest);
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

  window.THL = window.THL || {};
  window.THL.toolkit = {
    loadManifest: loadManifest,
    findTool: findTool,
    validateArgs: validateArgs,
    probeEncoders: probeEncoders,
    run: run,
    runImageConvert: runImageConvert,
    renderParamTable: renderParamTable,
    describeParams: describeParams,
    filenameFor: filenameFor,
    formatBytes: formatBytes,
    sizeDelta: sizeDelta
  };

})();
