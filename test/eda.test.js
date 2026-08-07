/* ============================================================
   eda.test.js — the browser EDA engine.

   Everything here runs against eda-engine.js's pure block, so these
   are the real functions the page calls, not a reimplementation.

   The statistics are checked against hand-computed values rather than
   against the code's own output. A test that asserts whatever the
   implementation currently returns proves only that it is
   deterministic.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const E = loadPure('eda-engine.js', [
  'parseTable', 'parseDelimited', 'parseJsonRows', 'sniffDelimiter',
  'inferColumnType', 'numericStats', 'numericValues', 'categoricalStats',
  'pearson', 'histogram', 'profile', 'correlations',
  'reportMarkdown', 'analysisScript', 'zipStore', 'crc32', 'slugify',
  'ROW_CAP', 'CONFIDENCE_FLOOR'
]);

/* ---- parsing ---- */

test('a quoted field containing the delimiter stays one field', () => {
  const csv = 'name,note\n"Ada, the first","a, b, c"\n';
  const t = E.parseTable(csv, {});
  assert.deepEqual(t.columns, ['name', 'note']);
  assert.equal(t.rows[0].name, 'Ada, the first');
  assert.equal(t.rows[0].note, 'a, b, c');
});

test('a quoted field containing a newline stays one row', () => {
  const csv = 'id,comment\n1,"line one\nline two"\n2,plain\n';
  const t = E.parseTable(csv, {});
  assert.equal(t.rows.length, 2, 'the embedded newline split the record');
  assert.equal(t.rows[0].comment, 'line one\nline two');
});

test('escaped double quotes survive', () => {
  const t = E.parseTable('a\n"she said ""hi"""\n', {});
  assert.equal(t.rows[0].a, 'she said "hi"');
});

test('the delimiter is sniffed, not assumed', () => {
  assert.equal(E.sniffDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6\n'), '\t');
  assert.equal(E.sniffDelimiter('a;b;c\n1;2;3\n4;5;6\n'), ';');
  assert.equal(E.sniffDelimiter('a,b,c\n1,2,3\n4,5,6\n'), ',');
});

test('header:false generates column names instead of eating a data row', () => {
  const t = E.parseTable('1,2\n3,4\n', { header: false });
  assert.deepEqual(t.columns, ['column_1', 'column_2']);
  assert.equal(t.rows.length, 2);
});

test('a blank header cell still gets a usable name', () => {
  const t = E.parseTable('a,,c\n1,2,3\n', {});
  assert.deepEqual(t.columns, ['a', 'column_2', 'c']);
});

test('JSON arrives as rows, and nested values are stringified not flattened', () => {
  const t = E.parseJsonRows('[{"a":1,"b":{"c":2}},{"a":3}]');
  assert.deepEqual(t.columns, ['a', 'b']);
  assert.equal(t.rows[0].b, '{"c":2}');
  assert.equal(t.rows[1].b, '', 'a missing key reads as null, not undefined');
});

test('JSONL is accepted one object per line', () => {
  const t = E.parseJsonRows('{"a":1}\n{"a":2}\n');
  assert.equal(t.rows.length, 2);
});

/* ---- sampling is never silent ---- */

test('a file past the row cap is sampled and says so', () => {
  const lines = ['n'];
  for (let i = 0; i < E.ROW_CAP + 500; i++) lines.push(String(i));
  const t = E.parseTable(lines.join('\n'), {});
  assert.equal(t.truncated, true);
  assert.equal(t.rows.length, E.ROW_CAP);
  assert.equal(t.totalRows, E.ROW_CAP + 500);

  const p = E.profile(t, {});
  assert.equal(p.sampled, true);
  assert.ok(p.warnings.some(w => /sample/i.test(w)), 'no warning told the reader it sampled');
});

/* ---- type inference ---- */

const repeat = (values, times) => {
  const out = [];
  for (let i = 0; i < times; i++) out.push(...values);
  return out;
};

test('numbers, booleans and dates are told apart', () => {
  assert.equal(E.inferColumnType(repeat(['1.5', '2.7', '3.1', '9.9'], 20)).type, 'numeric_continuous');
  assert.equal(E.inferColumnType(repeat(['true', 'false'], 30)).type, 'boolean');
  assert.equal(E.inferColumnType(repeat(['yes', 'no'], 30)).type, 'boolean');
  assert.equal(E.inferColumnType(repeat(['2024-01-15', '2023-06-02'], 30)).type, 'datetime');
});

/* 0/1 satisfies both boolean and numeric. Getting this backwards means
   reporting the mean of a flag column. */
test('a 0/1 column is boolean, not a quantity', () => {
  assert.equal(E.inferColumnType(repeat(['0', '1'], 40)).type, 'boolean');
});

/* A four-digit year in a quantity column must not become a date. */
test('a bare number is not mistaken for a date', () => {
  assert.equal(E.inferColumnType(repeat(['2019', '2020', '1998', '2024'], 20)).type, 'numeric_discrete');
});

test('a unique whole-number column is an identifier, not a measurement', () => {
  const ids = [];
  for (let i = 1; i <= 200; i++) ids.push(String(i));
  assert.equal(E.inferColumnType(ids).type, 'identifier');
});

test('a small repeated vocabulary is a low-cardinality category', () => {
  const r = E.inferColumnType(repeat(['EU', 'US', 'APAC'], 40));
  assert.equal(r.type, 'categorical_low');
  assert.ok(r.confidence > 0.9, 'expected high confidence, got ' + r.confidence);
});

test('long prose is free text', () => {
  const prose = [];
  for (let i = 0; i < 40; i++) prose.push('a sentence that is comfortably longer than sixty characters, number ' + i);
  assert.equal(E.inferColumnType(prose).type, 'free_text');
});

test('all-null and single-value columns are named as such', () => {
  assert.equal(E.inferColumnType(['', 'NA', 'null', 'n/a']).type, 'empty');
  assert.equal(E.inferColumnType(repeat(['same'], 30)).type, 'constant');
});

/* A small sample cannot support a confident claim, and the score has to
   say so rather than reading as certainty or as zero. */
test('confidence reflects sample size, and is never a bare 0', () => {
  const tiny = E.inferColumnType(['a', 'b', 'c']);
  const big = E.inferColumnType(repeat(['a', 'b', 'c'], 60));
  assert.ok(tiny.confidence > 0, 'a tiny sample scored exactly 0, which reads as broken');
  assert.ok(big.confidence > tiny.confidence, 'more evidence should raise confidence');
});

test('nulls are counted, not silently dropped', () => {
  const r = E.inferColumnType(['1', '', '3', 'NA', '5']);
  assert.equal(r.nulls, 2);
  assert.equal(r.count, 3);
  assert.equal(Math.round(r.nullFraction * 100), 40);
});

/* ---- statistics, against hand-computed values ---- */

test('descriptive statistics match values computed by hand', () => {
  // 2,4,4,4,5,5,7,9 — the textbook set: mean 5, population sd 2, sample sd ~2.138
  const s = E.numericStats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.count, 8);
  assert.equal(s.mean, 5);
  assert.equal(s.min, 2);
  assert.equal(s.max, 9);
  assert.equal(s.median, 4.5);
  assert.ok(Math.abs(s.std - 2.1381) < 0.001, 'sample sd was ' + s.std);
});

test('quartiles interpolate rather than rounding to a member', () => {
  const s = E.numericStats([1, 2, 3, 4]);
  assert.equal(s.q1, 1.75);
  assert.equal(s.median, 2.5);
  assert.equal(s.q3, 3.25);
});

test('outliers follow the 1.5 IQR rule', () => {
  const s = E.numericStats([10, 11, 12, 13, 14, 15, 200]);
  assert.equal(s.outliers, 1, '200 should sit outside the fence');
  const clean = E.numericStats([10, 11, 12, 13, 14, 15]);
  assert.equal(clean.outliers, 0);
});

test('zeros and negatives are counted separately from nulls', () => {
  const s = E.numericStats([-2, -1, 0, 0, 5]);
  assert.equal(s.zeros, 2);
  assert.equal(s.negatives, 2);
});

test('numeric parsing rejects what Number() is too generous about', () => {
  const vals = E.numericValues(['1', '2.5', '1e3', '0x1f', 'Infinity', '', 'abc', '1,234', '50%']);
  assert.deepEqual(vals, [1, 2.5, 1000, 1234, 0.5],
    'hex, Infinity and prose must not become numbers; thousands separators and percents should');
});

test('pearson finds a known relationship and rejects too-small samples', () => {
  assert.equal(E.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1, 'perfect positive');
  assert.equal(E.pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1, 'perfect negative');
  assert.equal(E.pearson([1, 2], [1, 2]), null, 'two points is not a correlation');
  assert.equal(E.pearson([1, 1, 1, 1], [1, 2, 3, 4]), null, 'no variance means no r');
});

test('histogram bins cover every value exactly once', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const h = E.histogram(values, 5);
  assert.equal(h.bins.length, 5);
  assert.equal(h.bins.reduce((n, b) => n + b.count, 0), values.length);
});

test('a constant column does not divide by a zero range', () => {
  const h = E.histogram([7, 7, 7]);
  assert.equal(h.bins.length, 1);
  assert.equal(h.bins[0].count, 3);
});

/* ---- end to end ---- */

const SAMPLE = [
  'id,region,revenue,units,churn',
  '1,EU,300.5,3,true',
  '2,US,500.0,5,false',
  '3,EU,700.5,7,true',
  '4,APAC,900.0,9,false',
  '5,US,1100.5,11,true'
].join('\n');

test('a profile reports every column and flags low confidence', () => {
  const t = E.parseTable(SAMPLE, {});
  const p = E.profile(t, {});
  assert.equal(p.rows, 5);
  assert.equal(p.columns.length, 5);
  p.columns.forEach(c => {
    assert.ok(E.CONFIDENCE_FLOOR !== undefined);
    assert.equal(c.flagged, c.confidence !== null && c.confidence < E.CONFIDENCE_FLOOR);
  });
});

test('correlations find the planted relationship', () => {
  const t = E.parseTable(SAMPLE, {});
  const p = E.profile(t, {});
  const c = E.correlations(t, p);
  const pair = c.pairs.find(x => (x.a === 'revenue' && x.b === 'units') || (x.a === 'units' && x.b === 'revenue'));
  assert.ok(pair, 'revenue and units are perfectly linear and should be paired');
  assert.ok(pair.r > 0.99, 'expected ~1, got ' + pair.r);
});

test('the report carries the schema, and says when it sampled', () => {
  const t = E.parseTable(SAMPLE, {});
  const p = E.profile(t, {});
  const md = E.reportMarkdown(p, E.correlations(t, p), { filename: 'sample.csv' });
  assert.match(md, /# Profile — sample\.csv/);
  assert.match(md, /\| Column \| Type \| Confidence \| Nulls \| Unique \|/);
  assert.match(md, /## Correlations/);
  assert.match(md, /nothing in this run left the machine/i);
});

test('the generated script is valid Python-shaped output carrying the recipe', () => {
  const script = E.analysisScript({
    filename: 'sales.csv', delimiter: ',', header: true, format: 'delimited',
    generatedAt: '2026-01-01T00:00:00.000Z',
    inferred: { revenue: 'numeric_continuous' }
  });
  assert.match(script, /import pandas as pd/);
  assert.match(script, /matplotlib\.use\("Agg"\)/, 'must not need a display to run');
  assert.match(script, /"revenue": "numeric_continuous"/, 'the inferred schema should travel with it');
  assert.match(script, /SOURCE = Path\("sales\.csv"\)/);
  // Balanced quotes are the failure mode when interpolating names.
  assert.equal((script.match(/"""/g) || []).length % 2, 0, 'unbalanced docstring quotes');
});

test('a filename with quotes cannot break out of the generated script', () => {
  const script = E.analysisScript({ filename: 'evil".csv', inferred: {} });
  assert.match(script, /SOURCE = Path\("evil\\"\.csv"\)/, 'the quote must be escaped');
});

/* ---- the zip ---- */

test('crc32 matches the standard test vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(E.crc32(bytes).toString(16), 'cbf43926');
});

test('the zip has the signatures and the entry count an extractor looks for', () => {
  const zip = E.zipStore([
    { name: 'a/report.md', data: '# hi\n' },
    { name: 'a/figures/x.png', data: new Uint8Array([1, 2, 3]) }
  ]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50, 'no local file header');

  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd !== -1, 'no end-of-central-directory record');
  assert.equal(dv.getUint16(eocd + 8, true), 2, 'wrong entry count');
});

test('zip entry names round-trip as utf-8', () => {
  const zip = E.zipStore([{ name: 'résumé.md', data: 'x' }]);
  const text = new TextDecoder().decode(zip);
  assert.match(text, /résumé\.md/);
});

/* The stem becomes a folder name inside the zip, so the property that
   matters is that nothing hostile survives it — not that it produces
   one particular string. */
test('slugify produces a folder stem that cannot escape the archive', () => {
  assert.equal(E.slugify('my sales data.csv'), 'my_sales_data');
  assert.equal(E.slugify('.csv'), 'dataset', 'an empty stem needs a fallback');

  for (const hostile of ['../../etc/passwd', 'C:\\Windows\\system32', 'a/b/c.csv', '..', '....//']) {
    const stem = E.slugify(hostile);
    assert.doesNotMatch(stem, /[/\\]/, 'a path separator survived: ' + stem);
    assert.doesNotMatch(stem, /\.\./, 'a traversal sequence survived: ' + stem);
    assert.ok(stem.length > 0, 'empty stem for ' + hostile);
  }
});

/* ---- the page keeps its runner ----
   The engine is useless if the page stops loading it or an element id
   drifts. These read the shipped HTML rather than trusting it. */

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/load-pure');

test('eda.html loads the engine and the glue, in that order', () => {
  const src = fs.readFileSync(path.join(ROOT, 'eda.html'), 'utf8');
  const engine = src.indexOf('src="eda-engine.js"');
  const glue = src.indexOf('src="eda.js"');
  assert.ok(engine !== -1, 'eda.html does not load eda-engine.js');
  assert.ok(glue !== -1, 'eda.html does not load eda.js');
  assert.ok(engine < glue, 'the glue must not be parsed before the engine it reads');
});

test('every element the runner reaches for exists in the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'eda.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'eda.js'), 'utf8');

  const ids = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  const missing = [...new Set(ids)].filter(id => !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, [],
    `eda.js queries ids that are not in eda.html:\n  ${missing.join('\n  ')}`);
});

/* The manifest is the contract; the assistant reads inPageRunner to
   decide where to send people. A stale entry sends them nowhere. */
test('the manifest declares the in-page runner accurately', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'manifest.json'), 'utf8'));
  const declared = manifest.tools.filter(t => t.inPageRunner);
  assert.ok(declared.length > 0, 'no tool declares an in-page runner');

  for (const tool of declared) {
    const runner = tool.inPageRunner;
    assert.ok(fs.existsSync(path.join(ROOT, runner.page)), `${tool.name} points at a missing page`);
    assert.equal(runner.rowCap, E.ROW_CAP,
      `${tool.name} advertises a ${runner.rowCap} row cap but the engine uses ${E.ROW_CAP}`);
    assert.ok(Array.isArray(runner.formats) && runner.formats.length, `${tool.name} lists no formats`);
  }
});

/* Shipped broken once: run() wrapped the analysis in
   requestAnimationFrame, which does not fire in a hidden tab. Clicking
   Analyse and switching away — the obvious thing to do while a large
   file works — left the page on "Analysing…" forever with the button
   disabled and no recovery but a reload.

   Checked at the source level because the failure needs a backgrounded
   tab to reproduce, which a unit test cannot create. */
test('starting the analysis does not depend on a frame being painted', () => {
  const src = fs.readFileSync(path.join(ROOT, 'eda.js'), 'utf8');
  const run = src.slice(src.indexOf('function run()'), src.indexOf('function analyse()'));

  assert.doesNotMatch(run, /requestAnimationFrame\s*\(/,
    'run() schedules work on requestAnimationFrame, which never fires in a hidden tab');
  assert.match(run, /setTimeout\s*\(/,
    'run() should yield with a timer, which fires whether or not the tab is visible');
});
