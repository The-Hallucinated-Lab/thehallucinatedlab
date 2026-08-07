/* ============================================================
   toolbench.js - the command you would type, with the arguments
   turned into controls.

   Two views of one state, side by side: the terminal line and the
   Python call. Change the format dropdown and both update, because both
   are rendered from the same object. There is no third copy of the
   argument list anywhere -- the controls, the command and the code all
   come from spec/manifest.json, which is the same file the CLI and the
   Assistant read. A tool that gains an argument gains it here on the
   next load, with no page to edit.

   That is the whole point of the thing. Hand-written examples in
   documentation are correct on the day they are written and drift
   silently afterwards; this cannot drift, because there is nothing to
   drift from.

   It builds a command. It does not run one. The [+] button reads a
   filename so the command is real, and the file never leaves the page --
   nothing is read, uploaded or executed. Running is what the tool pages'
   own runners and `thl serve` are for.

   No inline handlers anywhere: every page sets script-src 'self' with no
   unsafe-inline, so a listener attribute would silently never fire.
   ============================================================ */

(function () {
  'use strict';

  var FILE_PLACEHOLDER = '[+]';

  /* @pure-start */

  /* Which params apply given the values chosen so far.

     `appliesTo` in the manifest names the values of the *first* enum that
     a param depends on -- quality applies to jpeg, webp and avif but not
     png. Hiding an inapplicable argument matters more here than in a
     table: a command line showing --quality next to --format png is a
     command that does nothing, and someone will copy it and wonder. */
  function applicable(params, values) {
    var enumParam = null;
    var i;
    for (i = 0; i < params.length; i++) {
      if (params[i].type === 'enum') { enumParam = params[i]; break; }
    }
    var chosen = enumParam ? values[enumParam.name] : null;
    var out = [];
    for (i = 0; i < params.length; i++) {
      var p = params[i];
      if (p.appliesTo && p.appliesTo.length && chosen && p.appliesTo.indexOf(chosen) === -1) {
        continue;
      }
      out.push(p);
    }
    return out;
  }

  /* A value is worth putting on the command line when the user set it to
     something other than the default. Echoing every default back turns a
     one-flag command into a wall, and teaches that the defaults must be
     stated, which is the opposite of true. */
  function isInteresting(param, value) {
    if (value === undefined || value === null || value === '') return false;
    if (param.required) return true;
    if (param.default === undefined) return true;
    return String(value) !== String(param.default);
  }

  function quotePython(text) {
    return '"' + String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /* The manifest names arguments the way Python takes them -- max_tokens,
     page_markers -- because that is the keyword the library binds. The
     CLI spells the same argument --max-tokens, which is the argparse
     convention and what `thl tool chunk --help` prints.
     One name, two spellings, and the terminal pane has to use the shell
     one or every command it shows is a command that errors out. */
  function flagName(name) {
    return name.replace(/_/g, '-');
  }

  /* Booleans that default to on exist only in their negative form --
     argparse has no native "flag that defaults to true", so the CLI
     defines --no-frontmatter and no --frontmatter at all. Because a value
     equal to its default is never printed, the true case never needs a
     flag and only the --no- form is ever emitted. */
  function booleanFlag(param, value) {
    return (value ? '--' : '--no-') + flagName(param.name);
  }

  /* The terminal form. Long lines wrap with a trailing backslash because
     that is what someone would actually type, and what survives a paste
     into a shell. */
  function terminalCommand(tool, values, filename) {
    var parts = ['thl tool ' + tool.name + ' ' + (filename || FILE_PLACEHOLDER)];
    var params = applicable(tool.params || [], values);
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var v = values[p.name];
      if (!isInteresting(p, v)) continue;
      if (p.type === 'boolean') {
        parts.push(booleanFlag(p, v));
      } else {
        parts.push('--' + flagName(p.name) + ' ' + v);
      }
    }
    return parts;
  }

  function pythonCall(tool, values, filename) {
    var args = [quotePython(filename || FILE_PLACEHOLDER)];
    var params = applicable(tool.params || [], values);
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var v = values[p.name];
      if (!isInteresting(p, v)) continue;
      var rendered;
      if (p.type === 'integer' || p.type === 'number') rendered = String(v);
      else if (p.type === 'boolean') rendered = v ? 'True' : 'False';
      else rendered = quotePython(v);
      args.push(p.name + '=' + rendered);
    }
    return { name: tool.name, args: args };
  }

  /* The plain-text forms, for the clipboard. What is copied has to be
     what is shown, so both are derived from the same two functions the
     renderer uses rather than scraped back out of the DOM. */
  function terminalText(tool, values, filename) {
    /* One line, because that is what the page shows and what is copied
       has to be what is shown. The stacked backslash form read as a
       script rather than as the thing you would type. */
    return terminalCommand(tool, values, filename).join(' ');
  }

  function pythonText(tool, values, filename) {
    var call = pythonCall(tool, values, filename);
    return 'result = thl.' + call.name + '(' + call.args.join(', ') + ')';
  }

  function defaultsFor(tool) {
    var values = {};
    var params = tool.params || [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      if (p.default !== undefined) values[p.name] = p.default;
      else if (p.required && p.type === 'enum' && p.values && p.values.length) {
        // A required enum has to show something, and the first value is
        // the only defensible pick when the spec names no default.
        values[p.name] = p.values[0];
      }
    }
    return values;
  }

  /* @pure-end */

  /* ---- Rendering ---- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function controlFor(param, values, onChange) {
    var input;
    if (param.type === 'enum') {
      input = el('select', 'tb-control tb-select');
      for (var i = 0; i < (param.values || []).length; i++) {
        var opt = el('option', null, param.values[i]);
        opt.value = param.values[i];
        input.appendChild(opt);
      }
      input.value = values[param.name];
    } else if (param.type === 'integer' || param.type === 'number') {
      input = el('input', 'tb-control tb-number');
      input.type = 'number';
      if (param.min !== undefined) input.min = param.min;
      if (param.max !== undefined) input.max = param.max;
      input.value = values[param.name] !== undefined ? values[param.name] : '';
    } else if (param.type === 'color') {
      input = el('input', 'tb-control tb-color');
      input.type = 'color';
      input.value = values[param.name] || '#ffffff';
    } else if (param.type === 'boolean') {
      input = el('input', 'tb-control tb-check');
      input.type = 'checkbox';
      input.checked = Boolean(values[param.name]);
    } else {
      input = el('input', 'tb-control tb-text');
      input.type = 'text';
      input.value = values[param.name] || '';
    }

    /* The accessible name has to come from somewhere: the visible label
       is the flag itself, which is not associated with the control, and
       a bare select announces as "combo box". */
    input.setAttribute('aria-label', param.name + (param.description ? ' - ' + param.description : ''));
    if (param.description) input.title = param.description;

    input.addEventListener(param.type === 'boolean' ? 'change' : 'input', function () {
      var v = param.type === 'boolean' ? input.checked : input.value;
      if ((param.type === 'integer' || param.type === 'number') && v !== '') v = Number(v);
      onChange(param.name, v);
    });
    return input;
  }

  /* ---- View mode ----

     One preference for the whole site, not one per widget. Someone who
     thinks in a terminal thinks in a terminal on every page, and a
     per-widget switch would make them say so again on each one.

     Kept beside the theme in localStorage and surfaced in the same place
     in the navbar, because it is the same kind of setting: how you want
     the site to talk to you. */
  var MODE_KEY = 'thl_codeview';
  var MODES = ['terminal', 'python'];

  function readMode() {
    try {
      var v = localStorage.getItem(MODE_KEY);
      return MODES.indexOf(v) === -1 ? 'terminal' : v;
    } catch (err) {
      /* Private mode throws rather than returning null. A view
         preference is not worth breaking the page over. */
      return 'terminal';
    }
  }

  function writeMode(value) {
    try { localStorage.setItem(MODE_KEY, value); } catch (err) { /* session only */ }
  }

  var listeners = [];
  function onModeChange(fn) { listeners.push(fn); }
  function setMode(value) {
    writeMode(value);
    document.documentElement.setAttribute('data-codeview', value);
    for (var i = 0; i < listeners.length; i++) listeners[i](value);
  }

  var ICONS = {
    /* A terminal prompt, and the Python two-snake mark reduced to
       something legible at 18px. Both filled, to match the nav glyphs. */
    terminal: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zM6.5 9.5L10 13l-3.5 3.5L5.4 15.4 7.8 13 5.4 10.6 6.5 9.5zM12 15h5v1.5h-5V15z',
    python: 'M12 2C9.5 2 8 3 8 5v2h4v1H6c-2 0-3 1.5-3 4s1 4 3 4h1v-2.5C7 11.7 8.7 10 10.5 10h4c1.4 0 2.5-1.1 2.5-2.5V5c0-2-1.5-3-3-3h-2zm-1.8 1.6a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zM17 8v2.5c0 1.8-1.7 3.5-3.5 3.5h-4C8.1 14 7 15.1 7 16.5V19c0 2 1.5 3 3 3h2c2.5 0 4-1 4-3v-2h-4v-1h6c2 0 3-1.5 3-4s-1-4-3-4h-1zm-3.2 10.6a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z',
  };

  /* The switch lives in the navbar, immediately left of the theme
     toggle, and is only built when the page actually has a builder on
     it. A control that changes nothing on the page it is sitting on is
     worse than no control. */
  function mountSwitch() {
    var navbar = document.querySelector('.navbar');
    var themeToggle = document.getElementById('theme-toggle');
    if (!navbar || document.getElementById('codeview-toggle')) return;

    var button = document.createElement('button');
    button.id = 'codeview-toggle';
    button.className = 'codeview-toggle';
    button.type = 'button';

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(path);
    button.appendChild(svg);

    function relabel(mode) {
      var next = mode === 'terminal' ? 'Python' : 'terminal';
      /* Show the icon for where the click takes you, not where you are —
         the same rule the theme toggle follows, so the two controls
         beside each other do not contradict one another. */
      path.setAttribute('d', mode === 'terminal' ? ICONS.python : ICONS.terminal);
      var text = 'Show commands as ' + next;
      button.setAttribute('aria-label', text);
      button.title = text;
    }
    relabel(readMode());
    onModeChange(relabel);

    button.addEventListener('click', function () {
      setMode(readMode() === 'terminal' ? 'python' : 'terminal');
    });

    /* Both controls go into one wrapper rather than straight into the
       navbar. The bar is justify-content: space-between, so a fifth
       child would redistribute every gap in it and drift the two
       toggles apart -- they belong together at the right-hand end.
       One wrapper keeps the bar at the four items it was laid out for. */
    if (themeToggle && themeToggle.parentNode === navbar) {
      var group = document.createElement('div');
      group.className = 'nav-controls';
      navbar.insertBefore(group, themeToggle);
      group.appendChild(button);
      group.appendChild(themeToggle);
    } else {
      navbar.appendChild(button);
    }
  }

  /* ---- Rendering ---- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function controlFor(param, values, onChange) {
    var input;
    if (param.type === 'enum') {
      input = el('select', 'tb-control tb-select');
      for (var i = 0; i < (param.values || []).length; i++) {
        var opt = el('option', null, param.values[i]);
        opt.value = param.values[i];
        input.appendChild(opt);
      }
      input.value = values[param.name];
    } else if (param.type === 'integer' || param.type === 'number') {
      input = el('input', 'tb-control tb-number');
      input.type = 'number';
      if (param.min !== undefined) input.min = param.min;
      if (param.max !== undefined) input.max = param.max;
      input.value = values[param.name] !== undefined ? values[param.name] : '';
    } else if (param.type === 'color') {
      input = el('input', 'tb-control tb-color');
      input.type = 'color';
      input.value = values[param.name] || '#ffffff';
    } else if (param.type === 'boolean') {
      input = el('input', 'tb-control tb-check');
      input.type = 'checkbox';
      input.checked = Boolean(values[param.name]);
    } else {
      input = el('input', 'tb-control tb-text');
      input.type = 'text';
      input.value = values[param.name] || '';
    }

    input.setAttribute('aria-label', param.name + (param.description ? ' - ' + param.description : ''));
    if (param.description) input.title = param.description;

    input.addEventListener(param.type === 'boolean' ? 'change' : 'input', function () {
      var v = param.type === 'boolean' ? input.checked : input.value;
      if ((param.type === 'integer' || param.type === 'number') && v !== '') v = Number(v);
      onChange(param.name, v);
    });
    return input;
  }

  function render(tool, mount) {
    var values = defaultsFor(tool);
    var filename = '';

    var wrap = el('div', 'toolbench');

    var head = el('div', 'tb-head');
    var label = el('span', 'tb-title');
    head.appendChild(label);
    head.appendChild(el('span', 'tb-hint', 'builds the command - nothing runs, nothing uploads'));
    wrap.appendChild(head);

    var body = el('div', 'tb-body');
    wrap.appendChild(body);

    var copy = el('button', 'tb-copy', 'Copy');
    copy.type = 'button';
    wrap.appendChild(copy);

    var picker = el('input');
    picker.type = 'file';
    picker.className = 'sr-only';
    if (tool.input && tool.input.accept) picker.accept = tool.input.accept.join(',');
    picker.addEventListener('change', function () {
      filename = picker.files && picker.files[0] ? picker.files[0].name : '';
      paint();
    });
    wrap.appendChild(picker);

    function fileButton() {
      var b = el('button', 'tb-file', filename || FILE_PLACEHOLDER);
      b.type = 'button';
      b.setAttribute('aria-label', filename
        ? 'Chosen file: ' + filename + '. Choose a different one.'
        : 'Choose a file to put in the command');
      b.addEventListener('click', function () { picker.click(); });
      return b;
    }

    function set(name, value) { values[name] = value; paint(); }

    /* One line, wrapping like a real terminal rather than one flag per
       row. The stacked form read as a script; this reads as the thing
       you would type. */
    function paint() {
      var mode = readMode();
      body.textContent = '';
      var params = applicable(tool.params || [], values);
      var line = el('div', 'tb-line');
      var i, p;

      if (mode === 'python') {
        label.textContent = 'thl.' + tool.name;
        line.appendChild(el('span', 'tb-cmd', 'result = thl.' + tool.name + '('));
        line.appendChild(fileButton());
        for (i = 0; i < params.length; i++) {
          p = params[i];
          line.appendChild(el('span', 'tb-punct', ','));
          line.appendChild(el('span', 'tb-kw', p.name + '='));
          line.appendChild(controlFor(p, values, set));
        }
        line.appendChild(el('span', 'tb-cmd', ')'));
      } else {
        label.textContent = 'thl ' + tool.name;
        line.appendChild(el('span', 'tb-cmd', 'thl tool ' + tool.name));
        line.appendChild(fileButton());
        for (i = 0; i < params.length; i++) {
          p = params[i];
          line.appendChild(el('span', 'tb-flag',
            p.type === 'boolean' ? booleanFlag(p, values[p.name]) : '--' + flagName(p.name)));
          if (p.type !== 'boolean') line.appendChild(controlFor(p, values, set));
        }
      }
      body.appendChild(line);
    }

    copy.addEventListener('click', function () {
      var text = readMode() === 'python'
        ? pythonText(tool, values, filename)
        : terminalText(tool, values, filename);
      var done = function () {
        copy.textContent = 'Copied';
        copy.classList.add('is-copied');
        setTimeout(function () {
          copy.textContent = 'Copy';
          copy.classList.remove('is-copied');
        }, 1600);
      };
      /* clipboard.writeText needs a secure context, which file:// and
         plain http are not. Say so rather than silently doing nothing. */
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          copy.textContent = 'Press Ctrl+C';
        });
      } else {
        copy.textContent = 'Press Ctrl+C';
      }
    });

    onModeChange(paint);
    paint();
    mount.textContent = '';
    mount.appendChild(wrap);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var mounts = document.querySelectorAll('[data-toolbench]');
    if (!mounts.length) return;
    if (!window.THL || !window.THL.toolkit) return;

    document.documentElement.setAttribute('data-codeview', readMode());
    mountSwitch();

    window.THL.toolkit.loadManifest().then(function (manifest) {
      for (var i = 0; i < mounts.length; i++) {
        var tool = window.THL.toolkit.findTool(manifest, mounts[i].getAttribute('data-toolbench'));
        if (tool) render(tool, mounts[i]);
      }
    }).catch(function () {
      /* The argument table below documents the same thing. */
    });
  });

  window.THL = window.THL || {};
  window.THL.toolbench = {
    terminalText: terminalText,
    pythonText: pythonText,
    applicable: applicable,
    isInteresting: isInteresting,
    defaultsFor: defaultsFor,
    readMode: readMode,
    setMode: setMode
  };
})();
