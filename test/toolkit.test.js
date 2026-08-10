/* ============================================================
   toolkit.test.js — argument validation and the argument-table model.

   These cover the half of toolkit.js that decides what a tool will
   accept. The canvas half needs a browser and is checked by hand; this
   is everything that can go wrong without one.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/manifest.json'), 'utf8'));

const { validateArgs, filenameFor, describeParams, formatBytes, sizeDelta, findTool,
        runsIn } =
  loadPure('toolkit.js', [
    'validateArgs', 'filenameFor', 'describeParams', 'formatBytes', 'sizeDelta', 'findTool',
    'runsIn',
  ]);

const imageConvert = findTool(manifest, 'convert');

test('the manifest actually contains the tool the site ships', () => {
  assert.ok(imageConvert, 'convert missing from spec/manifest.json');
  assert.equal(findTool(manifest, 'nope'), null);
});

test('defaults are filled in for anything not supplied', () => {
  const result = validateArgs({ format: 'png' }, imageConvert);
  assert.ok(result.ok, result.errors.join(' '));
  assert.equal(result.args.quality, 92);
  assert.equal(result.args.background, '#ffffff');
});

test('a missing required argument is reported, not defaulted', () => {
  const result = validateArgs({ quality: 80 }, imageConvert);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('format is required')), result.errors.join(' '));
});

test('enum aliases resolve to the canonical value', () => {
  for (const [input, expected] of [['jpg', 'jpeg'], ['JPG', 'jpeg'], [' jfif ', 'jpeg'], ['png', 'png']]) {
    const result = validateArgs({ format: input }, imageConvert);
    assert.ok(result.ok, result.errors.join(' '));
    assert.equal(result.args.format, expected);
  }
});

test('an unknown format is rejected with the list of real ones', () => {
  const result = validateArgs({ format: 'tiff' }, imageConvert);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /png, jpeg, webp, avif/);
});

test('quality bounds from the manifest are enforced at both ends', () => {
  assert.equal(validateArgs({ format: 'jpeg', quality: 0 }, imageConvert).ok, false);
  assert.equal(validateArgs({ format: 'jpeg', quality: 101 }, imageConvert).ok, false);
  assert.equal(validateArgs({ format: 'jpeg', quality: 200 }, imageConvert).ok, false);
  assert.equal(validateArgs({ format: 'jpeg', quality: 1 }, imageConvert).ok, true);
  assert.equal(validateArgs({ format: 'jpeg', quality: 100 }, imageConvert).ok, true);
});

test('quality must be a whole number', () => {
  const result = validateArgs({ format: 'jpeg', quality: 82.5 }, imageConvert);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /whole number/);
});

test('every problem is reported at once rather than one per attempt', () => {
  const result = validateArgs({ quality: 999, background: 'octarine' }, imageConvert);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3, result.errors.join(' | '));
});

test('colours are accepted short or long and normalised to six digits', () => {
  assert.equal(validateArgs({ format: 'jpeg', background: '#f00' }, imageConvert).args.background, '#ff0000');
  assert.equal(validateArgs({ format: 'jpeg', background: '#ABCDEF' }, imageConvert).args.background, '#abcdef');
  assert.equal(validateArgs({ format: 'jpeg', background: 'red' }, imageConvert).ok, false);
});

test('an argument the tool does not have is an error, not a silent no-op', () => {
  const result = validateArgs({ format: 'png', widht: 800 }, imageConvert);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unknown argument "widht"/);
});

test('output filenames keep the stem and swap the extension', () => {
  assert.equal(filenameFor('photo.jpeg', 'png'), 'photo.png');
  assert.equal(filenameFor('holiday snap.JPG', 'webp'), 'holiday snap.webp');
  assert.equal(filenameFor('my-photo.png', 'jpg'), 'my-photo.jpg');
  assert.equal(filenameFor('archive.tar.gz', 'png'), 'archive.tar.png');
});

test('output filenames survive input that has no usable stem', () => {
  assert.equal(filenameFor('', 'png'), 'converted.png');
  assert.equal(filenameFor(null, 'png'), 'converted.png');
  assert.equal(filenameFor('.gitignore', 'png'), '.gitignore.png');
});

test('output filenames cannot carry a path or a shell-hostile character', () => {
  assert.equal(filenameFor('/etc/passwd.jpg', 'png'), 'passwd.png');
  assert.equal(filenameFor('..\\..\\win.jpg', 'png'), 'win.png');
  assert.equal(filenameFor('a"b:c|d?.jpg', 'png'), 'abcd.png');
});

test('the argument table model matches the manifest, so docs cannot go stale', () => {
  const rows = describeParams(imageConvert);
  assert.equal(rows.length, imageConvert.params.length);

  const format = rows.find(r => r.name === 'format');
  assert.equal(format.required, true);
  assert.equal(format.fallback, 'required');
  assert.equal(format.type, 'png | jpeg | webp | avif');

  const quality = rows.find(r => r.name === 'quality');
  assert.equal(quality.required, false);
  assert.equal(quality.fallback, '92');
  assert.equal(quality.type, 'int 1-100');

  for (const row of rows) {
    assert.ok(row.description.length > 0, `${row.name} has no description in the manifest`);
  }
});

test('byte sizes read the way a human would write them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(-1), '');
});

test('size delta is negative when the conversion actually saved space', () => {
  assert.equal(sizeDelta(1000, 500), -50);
  assert.equal(sizeDelta(1000, 1500), 50);
  assert.equal(sizeDelta(0, 500), null);
});

/* ============================================================
   Where a tool runs.

   The spec has carried `runtimes` since embed and index arrived, and
   nothing read it. The Assistant listed every tool under "what I can run
   right here in the page" and would take a file attachment before
   failing on one that needs Python.
   ============================================================ */

test('every tool says where it runs, and says something real', () => {
  for (const tool of manifest.tools) {
    const declared = tool.runtimes || [];
    assert.ok(declared.length, `${tool.name} does not say where it runs`);
    for (const runtime of declared) {
      assert.ok(['browser', 'python'].includes(runtime),
        `${tool.name} claims an unknown runtime "${runtime}"`);
      assert.equal(runsIn(tool, runtime), true);
    }
  }
});

test('a tool with no runtimes declared is treated as browser work', () => {
  /* Every tool written before the field existed ran in the page, so the
     absent case has to keep meaning that or an older spec would silently
     stop being offered. */
  assert.equal(runsIn({ name: 'legacy' }, 'browser'), true);
  assert.equal(runsIn({ name: 'legacy' }, 'python'), false);
});

test('the python-only tools are known, and are not offered as browser work', () => {
  const pythonOnly = manifest.tools.filter(t => !runsIn(t, 'browser')).map(t => t.name);
  /* Named rather than counted: adding a python-only tool should make
     somebody read this line and decide, not just bump a number. */
  assert.deepEqual(pythonOnly.sort(), [
    /* link is the deliberate odd one: it is python-only because it is
       not browser work, and unimplemented in both runtimes for now.
       Python reports that through ToolNotFound; the browser never
       offers it at all, which is the answer this list exists to keep
       honest. */
    'describe_dataset', 'eda_report', 'embed', 'index', 'link', 'plot_column',
    'profile_column', 'relate_columns',
  ]);
  for (const name of pythonOnly) {
    assert.equal(runsIn(findTool(manifest, name), 'python'), true,
      `${name} runs nowhere at all`);
  }
});
