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
    var parts = terminalCommand(tool, values, filename);
    if (parts.length === 1) return parts[0];
    return parts[0] + ' \\\n  ' + parts.slice(1).join(' \\\n  ');
  }

  function pythonText(tool, values, filename) {
    var call = pythonCall(tool, values, filename);
    if (call.args.length === 1) {
      return 'result = thl.' + call.name + '(' + call.args[0] + ')';
    }
    return 'result = thl.' + call.name + '(\n    ' + call.args.join(',\n    ') + ',\n)';
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

  function render(tool, mount) {
    var values = defaultsFor(tool);
    var filename = '';

    var wrap = el('div', 'toolbench');

    var head = el('div', 'tb-head');
    head.appendChild(el('span', 'tb-title', 'thl ' + tool.name));
    head.appendChild(el('span', 'tb-hint', 'builds the command - nothing runs, nothing uploads'));
    wrap.appendChild(head);

    var grid = el('div', 'tb-grid');

    var termPane = el('div', 'tb-pane');
    termPane.appendChild(el('span', 'tb-pane-label', 'Terminal'));
    var termBody = el('div', 'tb-body tb-term');
    termPane.appendChild(termBody);
    var termCopy = el('button', 'tb-copy', 'Copy');
    termCopy.type = 'button';
    termPane.appendChild(termCopy);
    grid.appendChild(termPane);

    var codePane = el('div', 'tb-pane');
    codePane.appendChild(el('span', 'tb-pane-label', 'Python'));
    var codeBody = el('div', 'tb-body tb-code');
    codePane.appendChild(codeBody);
    var codeCopy = el('button', 'tb-copy', 'Copy');
    codeCopy.type = 'button';
    codePane.appendChild(codeCopy);
    grid.appendChild(codePane);

    wrap.appendChild(grid);

    /* One file input, shared by both views: the two panes are two
       renderings of one state, so a file picked in either is the same
       file. */
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

    function paint() {
      termBody.textContent = '';
      codeBody.textContent = '';
      var params = applicable(tool.params || [], values);
      var i, p;

      /* -- terminal -- */
      var line = el('div', 'tb-line');
      line.appendChild(el('span', 'tb-cmd', 'thl tool ' + tool.name));
      line.appendChild(fileButton());
      termBody.appendChild(line);
      for (i = 0; i < params.length; i++) {
        p = params[i];
        var row = el('div', 'tb-line tb-arg');
        row.appendChild(el('span', 'tb-flag',
          p.type === 'boolean' ? booleanFlag(p, values[p.name]) : '--' + flagName(p.name)));
        row.appendChild(controlFor(p, values, set));
        if (!p.required && p.default !== undefined
            && String(values[p.name]) === String(p.default)) {
          row.appendChild(el('span', 'tb-default', 'default'));
        }
        termBody.appendChild(row);
      }

      /* -- python -- */
      var open = el('div', 'tb-line');
      open.appendChild(el('span', 'tb-cmd', 'result = thl.' + tool.name + '('));
      codeBody.appendChild(open);
      var argRow = el('div', 'tb-line tb-arg');
      argRow.appendChild(fileButton());
      argRow.appendChild(el('span', 'tb-punct', ','));
      codeBody.appendChild(argRow);
      for (i = 0; i < params.length; i++) {
        p = params[i];
        var crow = el('div', 'tb-line tb-arg');
        crow.appendChild(el('span', 'tb-kw', p.name + '='));
        crow.appendChild(controlFor(p, values, set));
        crow.appendChild(el('span', 'tb-punct', ','));
        codeBody.appendChild(crow);
      }
      codeBody.appendChild(el('div', 'tb-line', ')'));
    }

    function copier(button, textFn) {
      button.addEventListener('click', function () {
        var text = textFn();
        var done = function () {
          button.textContent = 'Copied';
          button.classList.add('is-copied');
          setTimeout(function () {
            button.textContent = 'Copy';
            button.classList.remove('is-copied');
          }, 1600);
        };
        /* clipboard.writeText needs a secure context, which file:// and
           plain http are not. Falling back keeps the button honest
           rather than silently doing nothing. */
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {
            button.textContent = 'Press Ctrl+C';
          });
        } else {
          button.textContent = 'Press Ctrl+C';
        }
      });
    }
    copier(termCopy, function () { return terminalText(tool, values, filename); });
    copier(codeCopy, function () { return pythonText(tool, values, filename); });

    paint();
    mount.textContent = '';
    mount.appendChild(wrap);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var mounts = document.querySelectorAll('[data-toolbench]');
    if (!mounts.length) return;
    if (!window.THL || !window.THL.toolkit) return;

    window.THL.toolkit.loadManifest().then(function (manifest) {
      for (var i = 0; i < mounts.length; i++) {
        var tool = window.THL.toolkit.findTool(manifest, mounts[i].getAttribute('data-toolbench'));
        if (tool) render(tool, mounts[i]);
      }
    }).catch(function () {
      /* The page documents the same arguments in prose and in the table
         below; losing the builder costs convenience, not information. */
    });
  });

  window.THL = window.THL || {};
  window.THL.toolbench = {
    terminalText: terminalText,
    pythonText: pythonText,
    applicable: applicable,
    isInteresting: isInteresting,
    defaultsFor: defaultsFor
  };
})();
