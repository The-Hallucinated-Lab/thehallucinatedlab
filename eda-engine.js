/* ============================================================
   eda-engine.js — the analysis itself, with no DOM in it.

   This is the browser half of `thl pipeline eda`. The Python package remains
   the complete implementation; what runs here is the part that can
   honestly run on a delimited text file in a tab:

     - read CSV / TSV / JSON / JSONL
     - infer a type and a confidence for every column
     - descriptive statistics, correlations, missingness
     - a Markdown report, a machine-readable summary, a replayable
       recipe, and the Python script that reproduces all of it

   What it deliberately does NOT do, because a browser cannot do it
   honestly: Parquet and XLSX (binary formats needing a real parser),
   and datasets past ROW_CAP rows, which are sampled with the sampling
   recorded rather than silently truncated.

   Everything here is pure: same input, same output, no globals, no
   fetch, no document. That is what makes it testable, and the
   @pure markers below are what the test harness reads.
   ============================================================ */
(function () {
  'use strict';

  /* @pure-start — no DOM, no network, no module state. */

  /* Past this many rows the browser is the wrong tool and pretending
     otherwise ends in a dead tab. We sample instead, and every report
     says that it sampled. */
  var ROW_CAP = 50000;

  /* Below this, a type is reported as a guess rather than asserted.
     Same floor the Python implementation uses. */
  var CONFIDENCE_FLOOR = 0.7;

  var DEFAULT_NA = ['', 'na', 'n/a', 'nan', 'null', 'none', '-', '?', 'nil'];

  var COLUMN_TYPES = [
    'numeric_continuous', 'numeric_discrete', 'boolean', 'categorical_low',
    'categorical_high', 'datetime', 'free_text', 'identifier', 'constant',
    'empty', 'unsupported'
  ];

  /* ---- delimited parsing ---------------------------------------
     A hand-rolled reader rather than a split(','), because a quoted
     field containing a comma or a newline is not an edge case in real
     data, it is Tuesday. */

  function sniffDelimiter(text) {
    var sample = text.slice(0, 64 * 1024).split(/\r?\n/).slice(0, 20);
    var candidates = [',', '\t', ';', '|'];
    var best = ',';
    var bestScore = -1;
    candidates.forEach(function (d) {
      var counts = sample.map(function (line) { return splitLine(line, d).length; });
      var nonEmpty = counts.filter(function (n) { return n > 1; });
      if (!nonEmpty.length) return;
      var first = nonEmpty[0];
      var consistent = nonEmpty.filter(function (n) { return n === first; }).length;
      // Reward both a high field count and a consistent one.
      var score = consistent * first;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function splitLine(line, delimiter) {
    var out = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        out.push(field); field = '';
      } else field += ch;
    }
    out.push(field);
    return out;
  }

  /* Splits on newlines that are not inside a quoted field. */
  function splitRecords(text) {
    var records = [];
    var current = '';
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        quoted = !quoted;
        current += ch;
      } else if (!quoted && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        records.push(current);
        current = '';
      } else current += ch;
    }
    if (current.length) records.push(current);
    return records;
  }

  function parseDelimited(text, options) {
    var opts = options || {};
    var delimiter = opts.delimiter || sniffDelimiter(text);
    var hasHeader = opts.header !== false;
    var lines = splitRecords(text).filter(function (l) { return l.trim() !== ''; });

    if (!lines.length) {
      return { columns: [], rows: [], delimiter: delimiter, truncated: false, totalRows: 0 };
    }

    var headerCells = splitLine(lines[0], delimiter).map(unquote);
    var columns = hasHeader
      ? headerCells.map(function (h, i) { return h.trim() || ('column_' + (i + 1)); })
      : headerCells.map(function (_, i) { return 'column_' + (i + 1); });

    var body = hasHeader ? lines.slice(1) : lines;
    var totalRows = body.length;
    var truncated = totalRows > ROW_CAP;
    if (truncated) body = body.slice(0, ROW_CAP);

    var rows = body.map(function (line) {
      var cells = splitLine(line, delimiter);
      var row = {};
      for (var i = 0; i < columns.length; i++) row[columns[i]] = unquote(cells[i]);
      return row;
    });

    return { columns: columns, rows: rows, delimiter: delimiter, truncated: truncated, totalRows: totalRows };
  }

  function unquote(value) {
    if (value === undefined || value === null) return '';
    var v = String(value).trim();
    if (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') {
      return v.slice(1, -1).replace(/""/g, '"');
    }
    return v;
  }

  /* JSON and JSONL both arrive as an array of flat objects. Nested
     values are stringified rather than flattened - inventing
     `address.city` columns from someone's nested payload is a decision
     the tool should not make silently. */
  function parseJsonRows(text) {
    var trimmed = text.trim();
    var data;
    if (trimmed[0] === '[') {
      data = JSON.parse(trimmed);
    } else {
      data = trimmed.split(/\r?\n/)
        .filter(function (l) { return l.trim() !== ''; })
        .map(function (l) { return JSON.parse(l); });
    }
    if (!Array.isArray(data)) throw new Error('Expected an array of records, or one JSON object per line.');

    var totalRows = data.length;
    var truncated = totalRows > ROW_CAP;
    if (truncated) data = data.slice(0, ROW_CAP);

    var seen = [];
    data.forEach(function (record) {
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        Object.keys(record).forEach(function (k) { if (seen.indexOf(k) === -1) seen.push(k); });
      }
    });

    var rows = data.map(function (record) {
      var row = {};
      seen.forEach(function (k) {
        var v = record ? record[k] : undefined;
        if (v === null || v === undefined) row[k] = '';
        else if (typeof v === 'object') row[k] = JSON.stringify(v);
        else row[k] = String(v);
      });
      return row;
    });

    return { columns: seen, rows: rows, delimiter: null, truncated: truncated, totalRows: totalRows };
  }

  function parseTable(text, options) {
    var opts = options || {};
    if (opts.format === 'json') return parseJsonRows(text);
    return parseDelimited(text, opts);
  }

  /* ---- type inference -------------------------------------------
     Every column gets a type AND a score. A column that looks numeric
     in 80% of its rows is reported at 0.8, not asserted as numeric,
     because the 20% is usually where the interesting problem is. */

  function isNull(value, naValues) {
    if (value === null || value === undefined) return true;
    return naValues.indexOf(String(value).trim().toLowerCase()) !== -1;
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    var s = String(value).trim().replace(/,/g, '');
    if (s === '') return NaN;
    // Reject things Number() is too generous about: '', '0x1f', Infinity.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(s)) return NaN;
    if (s.slice(-1) === '%') return parseFloat(s) / 100;
    return Number(s);
  }

  var BOOL_TRUE = ['true', 'yes', 'y', 't', '1'];
  var BOOL_FALSE = ['false', 'no', 'n', 'f', '0'];

  function looksBoolean(v) {
    var s = String(v).trim().toLowerCase();
    return BOOL_TRUE.indexOf(s) !== -1 || BOOL_FALSE.indexOf(s) !== -1;
  }

  /* Deliberately conservative. An ISO-ish date or a slash date counts;
     a bare four-digit number does not, because "2019" in a column of
     quantities is a quantity. */
  function looksDate(v) {
    var s = String(v).trim();
    if (s.length < 6) return false;
    if (!/[-/:]/.test(s)) return false;
    if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s)) return false;
    return !Number.isNaN(Date.parse(s));
  }

  function inferColumnType(values, naValues) {
    var na = naValues || DEFAULT_NA;
    var present = [];
    var nulls = 0;
    for (var i = 0; i < values.length; i++) {
      if (isNull(values[i], na)) nulls++;
      else present.push(values[i]);
    }

    var total = values.length;
    var result = {
      nulls: nulls,
      nullFraction: total ? nulls / total : 0,
      count: present.length
    };

    if (!present.length) {
      result.type = 'empty';
      result.confidence = 1;
      result.unique = 0;
      return result;
    }

    var uniques = {};
    for (var j = 0; j < present.length; j++) uniques[present[j]] = (uniques[present[j]] || 0) + 1;
    var uniqueKeys = Object.keys(uniques);
    result.unique = uniqueKeys.length;

    if (uniqueKeys.length === 1) {
      result.type = 'constant';
      result.confidence = 1;
      return result;
    }

    var tally = tallyShapes(present);
    var numeric = tally.numeric, integral = tally.integral;
    var n_ = present.length;
    var numericScore = numeric / n_;
    var boolScore = tally.boolish / n_;
    var dateScore = tally.dateish / n_;
    var uniqueRatio = uniqueKeys.length / n_;

    /* Order matters. Boolean before numeric, because 0/1 satisfies both
       and "is_active" is not a quantity. Date before numeric for the
       same reason with timestamps. */
    if (boolScore >= 0.95 && uniqueKeys.length <= 2) {
      result.type = 'boolean';
      result.confidence = round(boolScore, 3);
    } else if (dateScore >= 0.8) {
      result.type = 'datetime';
      result.confidence = round(dateScore, 3);
    } else if (numericScore >= 0.8) {
      /* A whole-number column that is distinct in almost every row is a
         key, not a measurement. Reporting the mean of a primary key is
         the kind of confidently wrong output that makes a profile
         useless, so it is caught here before the numeric branch. */
      if (integral === numeric && uniqueRatio > 0.99 && n_ > 20) {
        result.type = 'identifier';
        result.confidence = round(uniqueRatio, 3);
      } else {
        var discrete = integral === numeric && uniqueKeys.length <= Math.max(20, n_ * 0.05);
        result.type = discrete ? 'numeric_discrete' : 'numeric_continuous';
        result.confidence = round(numericScore, 3);
      }
    } else {
      var text = classifyText(present, uniqueKeys.length, uniqueRatio);
      result.type = text.type;
      result.confidence = text.confidence;
    }

    return result;
  }

  /* One pass counting how many values could be read as each shape.
     Separate from the decision that follows so the counting and the
     judgement can be read - and changed - independently. */
  function tallyShapes(present) {
    var numeric = 0, boolish = 0, dateish = 0, integral = 0;
    for (var i = 0; i < present.length; i++) {
      var value = present[i];
      var asNumber = toNumber(value);
      if (!Number.isNaN(asNumber)) {
        numeric++;
        if (Number.isInteger(asNumber)) integral++;
      }
      if (looksBoolean(value)) boolish++;
      if (looksDate(value)) dateish++;
    }
    return { numeric: numeric, boolish: boolish, dateish: dateish, integral: integral };
  }

  /* Everything that is not a number, a boolean or a date. Split out of
     inferColumnType so each half stays readable and this half can be
     reasoned about on its own. */
  function classifyText(present, uniqueCount, uniqueRatio) {
    var n = present.length;
    var totalLen = 0;
    for (var i = 0; i < n; i++) totalLen += String(present[i]).length;
    var avgLen = totalLen / n;

    /* Confidence in "this is a category" is really confidence that
       values repeat. A column where every value is distinct is not a
       category, whatever its cardinality.

       The sample-size term matters: three distinct values in six rows
       and three in six thousand are not equally informative, and the
       first should not be reported as if it were. Small n pulls every
       score toward 0.5 rather than letting a handful of rows assert
       anything. */
    var repetition = n > 1 ? 1 - (uniqueCount - 1) / (n - 1) : 0;
    var evidence = Math.min(1, n / 50);
    var score = round(0.5 + (repetition - 0.5) * evidence, 3);

    if (uniqueRatio > 0.95) {
      /* Distinct in almost every row. Long values are free text, short
         ones are an identifier - neither is a category. */
      return {
        type: avgLen > 40 ? 'free_text' : 'identifier',
        confidence: round(0.5 + (uniqueRatio - 0.5) * evidence, 3)
      };
    }
    if (avgLen > 60) {
      return { type: 'free_text', confidence: round(Math.min(0.95, avgLen / 100), 3) };
    }
    return {
      type: uniqueCount <= 20 ? 'categorical_low' : 'categorical_high',
      confidence: score
    };
  }

  function round(n, places) {
    if (!Number.isFinite(n)) return null;
    var f = Math.pow(10, places === undefined ? 4 : places);
    return Math.round(n * f) / f;
  }

  /* ---- statistics ------------------------------------------------ */

  function numericValues(values, naValues) {
    var na = naValues || DEFAULT_NA;
    var out = [];
    for (var i = 0; i < values.length; i++) {
      if (isNull(values[i], na)) continue;
      var n = toNumber(values[i]);
      if (!Number.isNaN(n)) out.push(n);
    }
    return out;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q;
    var base = Math.floor(pos);
    var rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

  function numericStats(nums) {
    if (!nums.length) return null;
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var sum = 0;
    for (var i = 0; i < n; i++) sum += sorted[i];
    var mean = sum / n;

    var m2 = 0, m3 = 0, m4 = 0;
    for (var j = 0; j < n; j++) {
      var d = sorted[j] - mean;
      m2 += d * d; m3 += d * d * d; m4 += d * d * d * d;
    }
    var variance = n > 1 ? m2 / (n - 1) : 0;
    var std = Math.sqrt(variance);
    var skew = (std > 0 && n > 2) ? (m3 / n) / Math.pow(m2 / n, 1.5) : 0;
    var kurtosis = (std > 0 && n > 3) ? (m4 / n) / Math.pow(m2 / n, 2) - 3 : 0;

    var q1 = quantile(sorted, 0.25);
    var q3 = quantile(sorted, 0.75);
    var iqr = q3 - q1;
    var lo = q1 - 1.5 * iqr;
    var hi = q3 + 1.5 * iqr;
    var outliers = 0;
    for (var k = 0; k < n; k++) if (sorted[k] < lo || sorted[k] > hi) outliers++;

    return {
      count: n,
      mean: round(mean),
      std: round(std),
      min: round(sorted[0]),
      q1: round(q1),
      median: round(quantile(sorted, 0.5)),
      q3: round(q3),
      max: round(sorted[n - 1]),
      skew: round(skew, 3),
      kurtosis: round(kurtosis, 3),
      zeros: sorted.filter(function (v) { return v === 0; }).length,
      negatives: sorted.filter(function (v) { return v < 0; }).length,
      outliers: outliers,
      outlierBounds: [round(lo), round(hi)]
    };
  }

  function categoricalStats(values, naValues, topN) {
    var na = naValues || DEFAULT_NA;
    var counts = {};
    var total = 0;
    for (var i = 0; i < values.length; i++) {
      if (isNull(values[i], na)) continue;
      var key = String(values[i]);
      counts[key] = (counts[key] || 0) + 1;
      total++;
    }
    var pairs = Object.keys(counts).map(function (k) { return { value: k, count: counts[k] }; });
    pairs.sort(function (a, b) { return b.count - a.count || (a.value < b.value ? -1 : 1); });
    var top = pairs.slice(0, topN || 10).map(function (p) {
      return { value: p.value, count: p.count, share: round(p.count / total, 4) };
    });
    return { total: total, unique: pairs.length, top: top };
  }

  function pearson(xs, ys) {
    var n = Math.min(xs.length, ys.length);
    if (n < 3) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    var mx = sx / n, my = sy / n;
    var num = 0, dx = 0, dy = 0;
    for (var j = 0; j < n; j++) {
      var a = xs[j] - mx, b = ys[j] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (dx === 0 || dy === 0) return null;
    return round(num / Math.sqrt(dx * dy), 4);
  }

  function histogram(nums, binCount) {
    if (!nums.length) return { bins: [], min: null, max: null };
    var min = Math.min.apply(null, nums);
    var max = Math.max.apply(null, nums);
    var k = binCount || Math.min(30, Math.max(5, Math.ceil(Math.sqrt(nums.length))));
    if (min === max) return { bins: [{ from: min, to: max, count: nums.length }], min: min, max: max };
    var width = (max - min) / k;
    var bins = [];
    for (var i = 0; i < k; i++) bins.push({ from: min + i * width, to: min + (i + 1) * width, count: 0 });
    for (var j = 0; j < nums.length; j++) {
      var idx = Math.min(k - 1, Math.floor((nums[j] - min) / width));
      bins[idx].count++;
    }
    return { bins: bins, min: min, max: max };
  }

  /* ---- the profile ------------------------------------------------ */

  function profile(table, options) {
    var opts = options || {};
    var na = opts.naValues || DEFAULT_NA;
    var columns = [];

    table.columns.forEach(function (name) {
      var values = table.rows.map(function (r) { return r[name]; });
      var inferred = inferColumnType(values, na);
      var entry = {
        name: name,
        type: inferred.type,
        confidence: inferred.confidence,
        flagged: inferred.confidence !== null && inferred.confidence < CONFIDENCE_FLOOR,
        nulls: inferred.nulls,
        nullFraction: round(inferred.nullFraction, 4),
        unique: inferred.unique
      };
      if (entry.type === 'numeric_continuous' || entry.type === 'numeric_discrete') {
        var nums = numericValues(values, na);
        entry.stats = numericStats(nums);
        entry.histogram = histogram(nums);
      } else if (entry.type !== 'empty') {
        entry.stats = categoricalStats(values, na, 10);
      }
      columns.push(entry);
    });

    var result = {
      rows: table.rows.length,
      totalRows: table.totalRows,
      sampled: table.truncated,
      columns: columns,
      warnings: []
    };

    if (table.truncated) {
      result.warnings.push(
        'Read the first ' + table.rows.length.toLocaleString('en-US') + ' of ' +
        table.totalRows.toLocaleString('en-US') + ' rows. Every number below describes the sample, not the file. ' +
        'Run it with the Python package for the whole thing.'
      );
    }
    var lowConfidence = columns.filter(function (c) { return c.flagged; });
    if (lowConfidence.length) {
      result.warnings.push(
        lowConfidence.length + ' column' + (lowConfidence.length === 1 ? '' : 's') +
        ' scored below ' + CONFIDENCE_FLOOR + ' on type inference: ' +
        lowConfidence.map(function (c) { return c.name; }).join(', ') + '. Treat those as a guess.'
      );
    }
    var allNull = columns.filter(function (c) { return c.type === 'empty'; });
    if (allNull.length) {
      result.warnings.push(allNull.length + ' column' + (allNull.length === 1 ? ' is' : 's are') + ' entirely null.');
    }

    return result;
  }

  function correlations(table, prof, naValues) {
    var na = naValues || DEFAULT_NA;
    var numericCols = prof.columns.filter(function (c) {
      return c.type === 'numeric_continuous' || c.type === 'numeric_discrete';
    }).map(function (c) { return c.name; });

    if (numericCols.length < 2) return { columns: numericCols, pairs: [], matrix: [] };

    var series = {};
    numericCols.forEach(function (name) {
      series[name] = table.rows.map(function (r) {
        var v = r[name];
        return isNull(v, na) ? NaN : toNumber(v);
      });
    });

    var matrix = [];
    var pairs = [];
    for (var i = 0; i < numericCols.length; i++) {
      var row = [];
      for (var j = 0; j < numericCols.length; j++) {
        if (i === j) { row.push(1); continue; }
        var xs = [], ys = [];
        var a = series[numericCols[i]], b = series[numericCols[j]];
        for (var k = 0; k < a.length; k++) {
          if (!Number.isNaN(a[k]) && !Number.isNaN(b[k])) { xs.push(a[k]); ys.push(b[k]); }
        }
        var r = pearson(xs, ys);
        row.push(r);
        if (j > i && r !== null) {
          pairs.push({ a: numericCols[i], b: numericCols[j], r: r, n: xs.length });
        }
      }
      matrix.push(row);
    }
    pairs.sort(function (p, q) { return Math.abs(q.r) - Math.abs(p.r); });
    return { columns: numericCols, pairs: pairs, matrix: matrix };
  }

  /* ---- output artefacts ------------------------------------------- */

  function reportMarkdown(profileResult, corr, meta) {
    var L = [];
    var m = meta || {};
    L.push('# Profile — ' + (m.filename || 'dataset'));
    L.push('');
    L.push('Generated in the browser by [The Hallucinated Lab](https://thehallucinatedlab.space/eda.html).');
    L.push('Nothing in this run left the machine it was produced on.');
    L.push('');
    L.push('- **Rows analysed**: ' + profileResult.rows.toLocaleString('en-US') +
      (profileResult.sampled ? ' (sampled from ' + profileResult.totalRows.toLocaleString('en-US') + ')' : ''));
    L.push('- **Columns**: ' + profileResult.columns.length);
    if (m.delimiter) L.push('- **Delimiter**: `' + (m.delimiter === '\t' ? '\\t' : m.delimiter) + '`');
    if (m.target) L.push('- **Target column**: `' + m.target + '`');
    L.push('');

    if (profileResult.warnings.length) {
      L.push('## Warnings');
      L.push('');
      profileResult.warnings.forEach(function (w) { L.push('- ' + w); });
      L.push('');
    }

    L.push('## Schema');
    L.push('');
    L.push('| Column | Type | Confidence | Nulls | Unique |');
    L.push('|---|---|---|---|---|');
    profileResult.columns.forEach(function (c) {
      L.push('| `' + c.name + '` | ' + c.type + ' | ' +
        (c.confidence === null ? '—' : c.confidence + (c.flagged ? ' ⚠' : '')) + ' | ' +
        c.nulls + ' (' + pct(c.nullFraction) + ') | ' + c.unique + ' |');
    });
    L.push('');
    L.push('Anything marked ⚠ scored below ' + CONFIDENCE_FLOOR + '. The type is a guess, not a finding.');
    L.push('');

    var numeric = profileResult.columns.filter(function (c) { return c.stats && c.stats.mean !== undefined; });
    if (numeric.length) {
      L.push('## Numeric columns');
      L.push('');
      L.push('| Column | count | mean | std | min | 25% | 50% | 75% | max | skew | outliers |');
      L.push('|---|---|---|---|---|---|---|---|---|---|---|');
      numeric.forEach(function (c) {
        var s = c.stats;
        L.push('| `' + c.name + '` | ' + s.count + ' | ' + s.mean + ' | ' + s.std + ' | ' + s.min +
          ' | ' + s.q1 + ' | ' + s.median + ' | ' + s.q3 + ' | ' + s.max + ' | ' + s.skew + ' | ' + s.outliers + ' |');
      });
      L.push('');
      L.push('Outliers are counted by the 1.5×IQR rule; the bounds are in `summary.json`.');
      L.push('');
    }

    var categorical = profileResult.columns.filter(function (c) { return c.stats && c.stats.top; });
    if (categorical.length) {
      L.push('## Categorical columns');
      L.push('');
      categorical.forEach(function (c) {
        L.push('### `' + c.name + '`');
        L.push('');
        L.push(c.stats.unique + ' distinct values across ' + c.stats.total + ' rows.');
        L.push('');
        L.push('| Value | Count | Share |');
        L.push('|---|---|---|');
        c.stats.top.forEach(function (t) {
          L.push('| ' + (t.value === '' ? '_(blank)_' : '`' + t.value + '`') + ' | ' + t.count + ' | ' + pct(t.share) + ' |');
        });
        L.push('');
      });
    }

    if (corr && corr.pairs.length) {
      L.push('## Correlations');
      L.push('');
      L.push('Pearson, strongest first. Correlation is not causation and this table is not evidence of one.');
      L.push('');
      L.push('| A | B | r | n |');
      L.push('|---|---|---|---|');
      corr.pairs.slice(0, 25).forEach(function (p) {
        L.push('| `' + p.a + '` | `' + p.b + '` | ' + p.r + ' | ' + p.n + ' |');
      });
      L.push('');
    }

    L.push('## Reproducing this');
    L.push('');
    L.push('`analysis.py` beside this file regenerates everything, and is meant to be edited.');
    L.push('`recipe.json` records the choices this run made so a rerun matches.');
    L.push('');
    return L.join('\n');
  }

  function pct(fraction) {
    if (fraction === null || fraction === undefined) return '—';
    return (fraction * 100).toFixed(1) + '%';
  }

  /* The script is the point: a report you cannot re-run is a screenshot.
     This one uses pandas rather than reimplementing the browser's maths,
     because on a full file pandas is what you should be using. */
  function analysisScript(recipe) {
    var r = recipe || {};
    var read = r.format === 'json'
      ? 'df = pd.read_json(SOURCE, lines=str(SOURCE).endswith(".jsonl"))'
      : 'df = pd.read_csv(SOURCE, sep=' + pyStr(r.delimiter || ',') + ', header=' + (r.header === false ? 'None' : '0') + ')';

    return [
      '"""Regenerates the profile that came with this file.',
      '',
      'Produced by the browser tool at https://thehallucinatedlab.space/eda.html',
      'on ' + (r.generatedAt || '') + '. The browser sampled at most ' + ROW_CAP.toLocaleString('en-US') + ' rows;',
      'this script does not - it reads the file whole.',
      '',
      'This file is meant to be edited. It is a starting point, not an artefact.',
      '"""',
      '',
      'from pathlib import Path',
      '',
      'import pandas as pd',
      'import matplotlib',
      'matplotlib.use("Agg")',
      'import matplotlib.pyplot as plt',
      '',
      'SOURCE = Path(' + pyStr(r.filename || 'data.csv') + ')',
      'OUT = SOURCE.with_suffix("") .with_name(SOURCE.stem + ".eda")',
      'OUT.mkdir(exist_ok=True)',
      '(OUT / "figures").mkdir(exist_ok=True)',
      '',
      read,
      '',
      'print(f"{len(df):,} rows x {len(df.columns)} columns")',
      'print(df.dtypes)',
      '',
      '# --- the schema this run inferred, for comparison -------------',
      'INFERRED = ' + pyDict(r.inferred || {}),
      'for column, kind in INFERRED.items():',
      '    if column in df.columns:',
      '        print(f"{column}: browser said {kind}, pandas says {df[column].dtype}")',
      '',
      '# --- descriptive statistics -----------------------------------',
      'summary = df.describe(include="all").transpose()',
      'summary.to_csv(OUT / "describe.csv")',
      'print(summary)',
      '',
      '# --- missingness ----------------------------------------------',
      'missing = df.isna().mean().sort_values(ascending=False)',
      'print(missing[missing > 0])',
      '',
      '# --- figures ---------------------------------------------------',
      'numeric = df.select_dtypes("number")',
      'for name in numeric.columns:',
      '    fig, ax = plt.subplots(figsize=(6, 4))',
      '    numeric[name].plot.hist(bins=30, ax=ax)',
      '    ax.set_title(name)',
      '    fig.tight_layout()',
      '    fig.savefig(OUT / "figures" / f"{name}_histogram.png", dpi=120)',
      '    plt.close(fig)',
      '',
      'if numeric.shape[1] >= 2:',
      '    corr = numeric.corr()',
      '    corr.to_csv(OUT / "correlations.csv")',
      '    fig, ax = plt.subplots(figsize=(7, 6))',
      '    im = ax.imshow(corr, vmin=-1, vmax=1, cmap="coolwarm")',
      '    ax.set_xticks(range(len(corr)), corr.columns, rotation=90)',
      '    ax.set_yticks(range(len(corr)), corr.columns)',
      '    fig.colorbar(im)',
      '    fig.tight_layout()',
      '    fig.savefig(OUT / "figures" / "correlation_matrix.png", dpi=120)',
      '    plt.close(fig)',
      '',
      'print(f"wrote {OUT}")',
      ''
    ].join('\n');
  }

  function pyStr(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t') + '"';
  }

  function pyDict(obj) {
    var keys = Object.keys(obj);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(function (k) {
      return '    ' + pyStr(k) + ': ' + pyStr(obj[k]) + ',';
    }).join('\n') + '\n}';
  }

  /* ---- zip (store, no compression) --------------------------------
     A handful of small text files and a few PNGs. Deflate would save
     little on the PNGs (already compressed) and would mean shipping a
     compressor. STORE is a valid ZIP that every extractor reads. */

  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        var next = str.charCodeAt(++i);
        var cp = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return new Uint8Array(out);
  }

  /* entries: [{ name, data }] where data is a Uint8Array or a string. */
  function zipStore(entries) {
    var files = entries.map(function (e) {
      var data = typeof e.data === 'string' ? utf8(e.data) : e.data;
      return { name: utf8(e.name), data: data, crc: crc32(data) };
    });

    var localSize = files.reduce(function (n, f) { return n + 30 + f.name.length + f.data.length; }, 0);
    var centralSize = files.reduce(function (n, f) { return n + 46 + f.name.length; }, 0);
    var out = new Uint8Array(localSize + centralSize + 22);
    var view = new DataView(out.buffer);
    var offset = 0;
    var offsets = [];

    files.forEach(function (f) {
      offsets.push(offset);
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 20, true);      // version needed
      view.setUint16(offset + 6, 0x0800, true);  // UTF-8 names
      view.setUint16(offset + 8, 0, true);       // stored
      view.setUint16(offset + 10, 0, true);      // time
      view.setUint16(offset + 12, 0x21, true);   // date (1980-01-01)
      view.setUint32(offset + 14, f.crc, true);
      view.setUint32(offset + 18, f.data.length, true);
      view.setUint32(offset + 22, f.data.length, true);
      view.setUint16(offset + 26, f.name.length, true);
      view.setUint16(offset + 28, 0, true);
      offset += 30;
      out.set(f.name, offset); offset += f.name.length;
      out.set(f.data, offset); offset += f.data.length;
    });

    var centralStart = offset;
    files.forEach(function (f, i) {
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true);
      view.setUint16(offset + 6, 20, true);
      view.setUint16(offset + 8, 0x0800, true);
      view.setUint16(offset + 10, 0, true);
      view.setUint16(offset + 12, 0, true);
      view.setUint16(offset + 14, 0x21, true);
      view.setUint32(offset + 16, f.crc, true);
      view.setUint32(offset + 20, f.data.length, true);
      view.setUint32(offset + 24, f.data.length, true);
      view.setUint16(offset + 28, f.name.length, true);
      view.setUint16(offset + 30, 0, true);
      view.setUint16(offset + 32, 0, true);
      view.setUint16(offset + 34, 0, true);
      view.setUint16(offset + 36, 0, true);
      view.setUint32(offset + 38, 0, true);
      view.setUint32(offset + 42, offsets[i], true);
      offset += 46;
      out.set(f.name, offset); offset += f.name.length;
    });

    view.setUint32(offset, 0x06054b50, true);
    view.setUint16(offset + 4, 0, true);
    view.setUint16(offset + 6, 0, true);
    view.setUint16(offset + 8, files.length, true);
    view.setUint16(offset + 10, files.length, true);
    view.setUint32(offset + 12, centralSize, true);
    view.setUint32(offset + 16, centralStart, true);
    view.setUint16(offset + 20, 0, true);

    return out;
  }

  function slugify(name) {
    return String(name).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset';
  }

  /* @pure-end */

  window.THL = window.THL || {};
  window.THL.eda = {
    ROW_CAP: ROW_CAP,
    CONFIDENCE_FLOOR: CONFIDENCE_FLOOR,
    COLUMN_TYPES: COLUMN_TYPES,
    DEFAULT_NA: DEFAULT_NA,
    sniffDelimiter: sniffDelimiter,
    parseTable: parseTable,
    parseDelimited: parseDelimited,
    parseJsonRows: parseJsonRows,
    inferColumnType: inferColumnType,
    numericValues: numericValues,
    numericStats: numericStats,
    categoricalStats: categoricalStats,
    pearson: pearson,
    histogram: histogram,
    profile: profile,
    correlations: correlations,
    reportMarkdown: reportMarkdown,
    analysisScript: analysisScript,
    zipStore: zipStore,
    crc32: crc32,
    slugify: slugify
  };

})();
