/* ============================================================
   extract.test.js — the parsing and assembly logic behind extract.html.

   The DOM half (drop zone, bridge probe, download) needs a browser. This
   covers everything that decides what the output document actually says,
   which is the part that has to agree with the Python implementation:
   both write the same frontmatter, the same page markers and the same
   tables, or the pipeline produces different chunks depending on which
   runtime happened to do stage one.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/manifest.json'), 'utf8'));
const extractTool = manifest.tools.find(t => t.name === 'extract');
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/extract-fixtures.json'), 'utf8'));

const {
  extensionOf, planFor, buildFrontmatter, pageMarker, normalizeNewlines,
  parseCsv, csvToMarkdown, markdownToText, assemble, outputName, timestamp,
} = loadPure('extract.js', [
  'extensionOf', 'planFor', 'buildFrontmatter', 'pageMarker', 'normalizeNewlines',
  'parseCsv', 'csvToMarkdown', 'markdownToText', 'assemble', 'outputName', 'timestamp',
]);

/* What `thl serve` reports when the extract extra IS installed. */
const FULL_BRIDGE = extractTool.meta.tiers.python;
/* ...and when it is running with only the standard library available. */
const BARE_BRIDGE = ['.csv', '.eml', '.htm', '.html', '.markdown', '.md', '.txt'];

/* ---- extensions ---- */

test('the last dot wins, so a versioned filename is still its real type', () => {
  assert.equal(extensionOf('report.final.pdf'), '.pdf');
  assert.equal(extensionOf('REPORT.PDF'), '.pdf');
  assert.equal(extensionOf('/home/me/notes.md'), '.md');
  assert.equal(extensionOf('C:\\docs\\notes.md'), '.md');
});

test('a dotfile is not an extension', () => {
  /* ".gitignore" is a name, not an extension — reading it as one would
     route the file to a parser for type ".gitignore". */
  assert.equal(extensionOf('.gitignore'), '');
  assert.equal(extensionOf('README'), '');
  assert.equal(extensionOf(''), '');
});

/* ---- tiers ---- */

test('native formats work with no bridge at all', () => {
  for (const ext of ['.txt', '.md', '.html', '.htm', '.csv']) {
    const plan = planFor(ext, extractTool.meta, []);
    assert.equal(plan.tier, 'native', ext);
    assert.equal(plan.ok, true, ext);
  }
});

test('a python-only format goes to the bridge when the bridge reports it', () => {
  for (const ext of ['.pdf', '.docx', '.pptx', '.xlsx', '.epub']) {
    const plan = planFor(ext, extractTool.meta, FULL_BRIDGE);
    assert.equal(plan.tier, 'bridge', ext);
    assert.equal(plan.ok, true, ext);
  }
});

test('a bridge that cannot read the format is not offered it', () => {
  /* The bridge running without the extract extra reads roughly what the
     tab already reads. Routing a PDF to it would fail only after the
     visitor had chosen the file — so refuse up front and say why. */
  const plan = planFor('.pdf', extractTool.meta, BARE_BRIDGE);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /thehallucinatedlab\[extract\]/);
});

test('with no bridge, a python-only format explains how to get one', () => {
  const plan = planFor('.docx', extractTool.meta, []);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /thl serve/);
});

test('a format no runtime claims is distinguishable from one that needs installing', () => {
  /* "install the package" is the wrong advice for a .zip — it still
     would not work afterwards, which is a worse outcome than being told
     plainly that nothing reads it. */
  const zip = planFor('.zip', extractTool.meta, FULL_BRIDGE);
  assert.equal(zip.tier, 'none');
  assert.equal(zip.ok, false);
  assert.doesNotMatch(zip.message, /pip install/);

  const none = planFor('', extractTool.meta, FULL_BRIDGE);
  assert.equal(none.ok, false);
  assert.match(none.message, /no extension/);
});

/* ---- frontmatter ---- */

test('frontmatter quotes strings and leaves numbers bare', () => {
  const yaml = buildFrontmatter({
    source: 'report.pdf', pages: 42, extracted: '2026-08-04T10:22:31Z',
  });
  assert.match(yaml, /^---\n/);
  assert.match(yaml, /\n---$/);
  assert.match(yaml, /source: "report\.pdf"/);
  assert.match(yaml, /pages: 42/);
});

test('a filename containing a quote cannot break out of the yaml block', () => {
  const yaml = buildFrontmatter({ source: 'we"ird".pdf' });
  assert.match(yaml, /source: "we\\"ird\\"\.pdf"/);
  /* Three delimiter lines would mean the block closed early and the rest
     of the filename became document body. */
  assert.equal(yaml.split('\n').filter(l => l === '---').length, 2);
});

test('empty fields are omitted rather than written as empty strings', () => {
  const yaml = buildFrontmatter({ source: 'a.txt', pages: null, extractor: '' });
  assert.doesNotMatch(yaml, /pages/);
  assert.doesNotMatch(yaml, /extractor/);
});

/* ---- csv ---- */

test('csv fields may contain commas, quotes and newlines', () => {
  const rows = parseCsv('name,address\n"Doe, J","1 High St\nLondon"\n"say ""hi""",x');
  assert.deepEqual(rows[0], ['name', 'address']);
  assert.deepEqual(rows[1], ['Doe, J', '1 High St\nLondon']);
  assert.deepEqual(rows[2], ['say "hi"', 'x']);
});

test('a csv becomes a markdown table with a header rule', () => {
  const md = csvToMarkdown('a,b\n1,2');
  assert.equal(md, '| a | b |\n| --- | --- |\n| 1 | 2 |');
});

test('a pipe inside a cell is escaped rather than ending the cell', () => {
  const md = csvToMarkdown('cmd\n"ls | wc"');
  assert.match(md, /ls \\\| wc/);
  /* Every row must have the same number of unescaped pipes, or the table
     stops being a table at the first cell containing one. */
  const bars = md.split('\n').map(l => (l.match(/(?<!\\)\|/g) || []).length);
  assert.equal(new Set(bars).size, 1);
});

test('ragged rows are padded so the table stays well formed', () => {
  const md = csvToMarkdown('a,b,c\n1');
  const widths = md.split('\n').map(l => l.split('|').length);
  assert.equal(new Set(widths).size, 1);
});

/* ---- assembly ---- */

const opts = { format: 'markdown', frontmatter: true, page_markers: true, tables: true };

test('page markers are comments, so they never land inside a chunk as text', () => {
  const out = assemble(
    [{ text: 'First page.', page: 1 }, { text: 'Second page.', page: 2 }],
    { source: 'a.pdf' }, opts);
  assert.match(out, /<!-- page: 1 -->/);
  assert.match(out, /<!-- page: 2 -->/);
  assert.equal(pageMarker(7), '<!-- page: 7 -->');
});

test('page markers can be turned off without losing the text', () => {
  const out = assemble([{ text: 'Body.', page: 3 }], { source: 'a.pdf' },
    Object.assign({}, opts, { page_markers: false }));
  assert.doesNotMatch(out, /<!-- page/);
  assert.match(out, /Body\./);
});

test('empty blocks are dropped rather than producing blank stretches', () => {
  const out = assemble(
    [{ text: 'One.' }, { text: '   ' }, { text: '' }, null, { text: 'Two.' }],
    { source: 'a.txt' }, opts);
  assert.doesNotMatch(out, /\n\n\n/);
  assert.match(out, /One\./);
  assert.match(out, /Two\./);
});

test('text format strips the structure it can no longer represent', () => {
  const out = assemble(
    [{ text: '# Heading', page: 1 }, { text: 'Body **bold**.' }],
    { source: 'a.pdf' }, Object.assign({}, opts, { format: 'text' }));
  assert.doesNotMatch(out, /^---/m);       // no frontmatter
  assert.doesNotMatch(out, /<!-- page/);   // no markers
  assert.doesNotMatch(out, /#/);           // no heading hashes
  assert.doesNotMatch(out, /\*\*/);        // no emphasis
  assert.match(out, /Heading/);
  assert.match(out, /Body bold\./);
});

test('markdownToText is only applied to markdown we produced', () => {
  const round = markdownToText('---\nsource: "a.pdf"\n---\n\n# Title\n\n- one\n- two\n');
  assert.equal(round, 'Title\n\none\ntwo');
});

/* ---- line endings ---- */

test('a CRLF document still splits into paragraphs', () => {
  /* /\n{2,}/ never matches \r\n\r\n — there is a \r between the two
     newlines — so without this a Windows-authored .txt reaches the
     chunker as one block the size of the whole file. */
  const normalized = normalizeNewlines('First para.\r\n\r\nSecond para.\r\n');
  assert.equal(normalized, 'First para.\n\nSecond para.\n');
  assert.equal(normalized.split(/\n{2,}/).length, 2);
});

test('lone carriage returns are normalised too', () => {
  assert.equal(normalizeNewlines('a\rb'), 'a\nb');
  assert.equal(normalizeNewlines(null), '');
});

test('the timestamp matches the shape Python writes, to the second', () => {
  /* toISOString() carries milliseconds; Python's strftime does not.
     Left alone, the same document gets visibly different frontmatter
     depending on which runtime read it. */
  const stamped = timestamp(new Date(Date.UTC(2026, 7, 4, 10, 22, 31, 346)));
  assert.equal(stamped, '2026-08-04T10:22:31Z');
  assert.match(stamped, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

/* ---- shared fixtures ---- */

test('every shared assembly fixture produces exactly the documented output', () => {
  /* The Python suite runs these same cases. A difference here means the
     pipeline produces different chunks depending on which runtime did
     stage one, which is the one thing the two implementations must
     never disagree about. */
  for (const c of fixtures.assembly) {
    assert.equal(assemble(c.blocks, c.meta, c.args), c.expected, c.name);
  }
});

test('every shared csv fixture produces exactly the documented table', () => {
  for (const c of fixtures.csv) {
    assert.equal(csvToMarkdown(c.input), c.expected, c.name);
  }
});

/* ---- naming ---- */

test('output names swap the extension for the chosen format', () => {
  assert.equal(outputName('report.pdf', 'markdown'), 'report.md');
  assert.equal(outputName('report.pdf', 'text'), 'report.txt');
  assert.equal(outputName('a/b/notes.docx', 'markdown'), 'notes.md');
});

test('output names cannot carry a path or a shell-hostile character', () => {
  assert.equal(outputName('../../etc/passwd.pdf', 'markdown'), 'passwd.md');
  assert.equal(outputName('re:po"rt|x.pdf', 'markdown'), 'reportx.md');
  assert.equal(outputName('', 'markdown'), 'extracted.md');
});

test('a dotfile keeps its name as the stem, matching convert', () => {
  /* filenameFor() in toolkit.js treats a leading dot as part of the name
     rather than an extension, so ".gitignore" converts to
     ".gitignore.png" there. Diverging here would mean the two tools
     named their output differently for the same input. */
  assert.equal(outputName('.gitignore', 'markdown'), '.gitignore.md');
});
