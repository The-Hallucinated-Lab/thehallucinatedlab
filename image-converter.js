/* ============================================================
   image-converter.js — page glue for image-converter.html.

   Owns the drop zone, the controls and the result panel. Everything
   that decides what an argument means lives in toolkit.js, and
   everything that decides what the arguments ARE lives in
   spec/manifest.json — this file only moves values between the DOM and
   the runtime.

   The controls are built from the manifest rather than hard-coded in
   the markup, so the page cannot offer a format or a range the tool
   does not actually support.

   Failure model:
     - Spec fails to load -> the panel says so and the drop zone stays
       disabled, rather than accepting a file it can never convert.
     - Browser cannot encode a format -> that option is disabled at
       startup by probeEncoders(), with a note saying why.
     - Conversion throws -> the message lands in the status line; the
       previously converted file stays downloadable.
   ============================================================ */
(function () {
  'use strict';

  var toolkit = window.THL && window.THL.toolkit;

  var manifest = null;
  var tool = null;
  var support = {};
  var sourceFile = null;
  var previewUrl = null;
  var downloadUrl = null;
  var busy = false;

  var el = {};

  document.addEventListener('DOMContentLoaded', function () {
    el = {
      drop: document.getElementById('drop-zone'),
      dropTitle: document.getElementById('drop-title'),
      dropHint: document.getElementById('drop-hint'),
      pick: document.getElementById('pick-file'),
      file: document.getElementById('file-input'),
      controls: document.getElementById('tool-controls'),
      format: document.getElementById('opt-format'),
      formatNote: document.getElementById('format-note'),
      quality: document.getElementById('opt-quality'),
      qualityValue: document.getElementById('quality-value'),
      qualityGroup: document.getElementById('quality-group'),
      background: document.getElementById('opt-background'),
      backgroundGroup: document.getElementById('background-group'),
      convert: document.getElementById('convert-btn'),
      status: document.getElementById('tool-status'),
      result: document.getElementById('tool-result'),
      preview: document.getElementById('result-preview'),
      name: document.getElementById('result-name'),
      facts: document.getElementById('result-facts'),
      download: document.getElementById('result-download'),
      args: document.getElementById('tool-args')
    };

    if (!toolkit || !el.drop) return;

    toolkit.loadManifest()
      .then(function (loaded) {
        manifest = loaded;
        tool = toolkit.findTool(manifest, 'image_convert');
        if (!tool) throw new Error('image_convert is not in the tool spec.');
        toolkit.renderParamTable(tool, el.args);
        applyParamBounds();
        return toolkit.probeEncoders(tool);
      })
      .then(function (probed) {
        support = probed;
        buildFormatOptions();
        bindEvents();
        syncControls();
      })
      .catch(function (err) {
        setStatus(err.message || 'The tool spec could not be loaded.', true);
        if (el.pick) el.pick.disabled = true;
      });
  });

  /* Freeing the object URLs matters more here than usual: an image blob
     can be tens of megabytes, and a visitor converting a batch would
     otherwise pin every one of them until the tab closed. */
  window.addEventListener('pagehide', releaseUrls);

  function releaseUrls() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  }

  function param(name) {
    var params = (tool && tool.params) || [];
    for (var i = 0; i < params.length; i++) {
      if (params[i].name === name) return params[i];
    }
    return null;
  }

  /* The slider's range comes from the manifest so the page and the
     validator cannot disagree about what counts as a legal quality. */
  function applyParamBounds() {
    var quality = param('quality');
    if (!quality || !el.quality) return;
    if (quality.min !== undefined) el.quality.min = String(quality.min);
    if (quality.max !== undefined) el.quality.max = String(quality.max);
    if (quality.default !== undefined) {
      el.quality.value = String(quality.default);
      el.qualityValue.textContent = String(quality.default);
    }
    var background = param('background');
    if (background && background.default && el.background) {
      el.background.value = background.default;
    }
  }

  function buildFormatOptions() {
    var formats = (param('format') || {}).values || [];
    var unsupported = [];

    el.format.textContent = '';
    formats.forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name.toUpperCase();
      if (support[name] === false) {
        option.disabled = true;
        option.textContent = name.toUpperCase() + ' — not supported here';
        unsupported.push(name.toUpperCase());
      }
      el.format.appendChild(option);
    });

    /* Pick the first format this browser can actually produce, so the
       control never opens on a disabled option. */
    for (var i = 0; i < formats.length; i++) {
      if (support[formats[i]] !== false) { el.format.value = formats[i]; break; }
    }

    el.formatNote.textContent = unsupported.length
      ? 'This browser cannot encode ' + unsupported.join(' or ') + '.'
      : '';
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

    el.format.addEventListener('change', syncControls);
    el.quality.addEventListener('input', function () {
      el.qualityValue.textContent = el.quality.value;
    });
    el.convert.addEventListener('click', convert);
  }

  function acceptFile(file) {
    if (!/^image\//.test(file.type)) {
      setStatus('That is not an image — pick a PNG, JPEG, WebP, AVIF, GIF or BMP.', true);
      return;
    }
    sourceFile = file;
    el.dropTitle.textContent = file.name;
    el.dropHint.textContent = toolkit.formatBytes(file.size) + ' · ready to convert';
    el.convert.disabled = false;
    setStatus('');
  }

  /* Quality and background only mean something for some targets. Hiding
     them rather than leaving them inert stops the page from implying a
     PNG conversion is lossy. */
  function syncControls() {
    var format = el.format.value;
    toggle(el.qualityGroup, applies(param('quality'), format));
    toggle(el.backgroundGroup, applies(param('background'), format));
  }

  function applies(spec, format) {
    if (!spec) return false;
    if (!spec.appliesTo) return true;
    return spec.appliesTo.indexOf(format) !== -1;
  }

  function toggle(node, visible) {
    if (node) node.hidden = !visible;
  }

  function convert() {
    if (busy || !sourceFile || !tool) return;

    var args = { format: el.format.value };
    if (applies(param('quality'), args.format)) args.quality = Number(el.quality.value);
    if (applies(param('background'), args.format)) args.background = el.background.value;

    busy = true;
    el.convert.disabled = true;
    setStatus('Converting…');

    toolkit.runImageConvert(sourceFile, args, manifest)
      .then(showResult)
      .catch(function (err) {
        setStatus(err.message || 'The conversion failed.', true);
      })
      .then(function () {
        busy = false;
        el.convert.disabled = !sourceFile;
      });
  }

  function showResult(result) {
    releaseUrls();
    previewUrl = URL.createObjectURL(result.blob);
    downloadUrl = previewUrl;

    el.preview.src = previewUrl;
    el.preview.width = result.width;
    el.preview.height = result.height;
    el.name.textContent = result.filename;

    el.facts.textContent = '';
    var facts = [
      result.width + ' × ' + result.height,
      toolkit.formatBytes(result.bytes),
      describeDelta(result)
    ];
    facts.forEach(function (text) {
      if (!text) return;
      var li = document.createElement('li');
      li.textContent = text;
      el.facts.appendChild(li);
    });

    el.download.href = downloadUrl;
    el.download.setAttribute('download', result.filename);
    el.result.hidden = false;
    setStatus('Done — converted to ' + result.format.toUpperCase() + '.');
  }

  function describeDelta(result) {
    if (result.delta === null || result.delta === undefined) return '';
    if (result.delta === 0) return 'same size as the original';
    var from = toolkit.formatBytes(result.sourceBytes);
    return result.delta < 0
      ? Math.abs(result.delta) + '% smaller than ' + from
      : result.delta + '% larger than ' + from;
  }

  function setStatus(message, isError) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.classList.toggle('is-error', !!isError);
  }

})();
