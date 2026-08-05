/* ============================================================
   eda.js — the argument reference on the EDA page.

   Five tools rather than one, so the page carries five tables. They are
   built from spec/manifest.json through the same renderParamTable the
   converter page uses, for the same reason: a hand-written table is a
   second copy of the contract, and the day someone changes a bound in
   the spec the page starts documenting an argument the package rejects.

   Nothing here runs a tool. These are python-only — profiling a 200 MB
   CSV is pandas work, not canvas work — so the page documents them and
   the command line does them.
   ============================================================ */

(function () {
  'use strict';

  /* The order the tables appear in, which is the order a person meets
     them: look at the file, then a column, then draw it, then compare
     columns, then render the whole report. */
  var TOOLS = [
    'describe_dataset',
    'profile_column',
    'plot_column',
    'relate_columns',
    'eda_report'
  ];

  function heading(tool) {
    var wrap = document.createElement('div');
    wrap.className = 'section-header';

    var title = document.createElement('h3');
    title.className = 'how-panel-title';
    var code = document.createElement('code');
    code.textContent = tool.name;
    title.appendChild(code);
    wrap.appendChild(title);

    var summary = document.createElement('p');
    summary.className = 'how-panel-text';
    summary.textContent = tool.summary || '';
    wrap.appendChild(summary);

    return wrap;
  }

  function renderInto(container, manifest) {
    var toolkit = window.THL && window.THL.toolkit;
    if (!toolkit) return;

    container.textContent = '';

    for (var i = 0; i < TOOLS.length; i++) {
      var tool = toolkit.findTool(manifest, TOOLS[i]);
      if (!tool) continue;

      var panel = document.createElement('div');
      panel.className = 'tool-args-group';
      panel.appendChild(heading(tool));

      var table = document.createElement('div');
      table.className = 'tool-args-wrap';
      toolkit.renderParamTable(tool, table);
      panel.appendChild(table);

      container.appendChild(panel);
    }
  }

  function failed(container, message) {
    container.textContent = '';
    var note = document.createElement('p');
    note.className = 'form-note';
    /* A spinner that never resolves reads as a broken page. Saying what
       happened, and where the same table lives, leaves the reader
       somewhere they can act. */
    note.textContent = message + ' The same arguments are in `thl eda --list` and in the spec at spec/manifest.json.';
    container.appendChild(note);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('eda-args');
    if (!container || !window.THL || !window.THL.toolkit) return;

    window.THL.toolkit.loadManifest()
      .then(function (manifest) { renderInto(container, manifest); })
      .catch(function (err) {
        console.warn('[THL] could not load the tool spec:', err);
        failed(container, 'The tool spec did not load.');
      });
  });
})();
