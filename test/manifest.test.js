/* ============================================================
   manifest.test.js — the tool spec is one file, not two.

   spec/manifest.json drives the website, the intent parser and the
   Python package. A wheel cannot reach outside its own root, so the
   package carries a copy. This is the seam where the site could start
   documenting arguments the library does not accept, so it is asserted
   rather than trusted.

   Also checks the fields the other consumers assume are present, which
   is really a guard for tool #2: the day someone adds a manifest entry
   without a description, the argument table on the site renders a blank
   cell and nothing else notices.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/load-pure');

const SPEC = 'spec/manifest.json';
const PACKAGED = 'python/thehallucinatedlab/data/manifest.json';

const read = rel => fs.readFileSync(path.join(ROOT, rel));
const manifest = JSON.parse(read(SPEC).toString('utf8'));

test('the packaged spec is byte-identical to the source of truth', () => {
  assert.ok(fs.existsSync(path.join(ROOT, PACKAGED)), `${PACKAGED} is missing`);
  assert.ok(read(SPEC).equals(read(PACKAGED)),
    `${SPEC} and ${PACKAGED} differ — run: node scripts/sync-spec.js`);
});

test('the spec declares the scoring weights the parser reads', () => {
  const scoring = manifest.scoring;
  assert.ok(scoring, 'no scoring block');
  for (const key of ['enumValue', 'aliasPhrase', 'actionKeyword', 'subjectKeyword', 'threshold']) {
    assert.equal(typeof scoring[key], 'number', `scoring.${key} is not a number`);
  }
  /* If the threshold ever drops to or below the weight of a single
     action word, "convert 100 usd to eur" starts matching the image
     converter. */
  assert.ok(scoring.threshold > scoring.actionKeyword,
    'threshold must exceed a lone action keyword');
});

test('every tool carries what the website and the package both read', () => {
  assert.ok(manifest.tools.length > 0, 'no tools declared');

  for (const tool of manifest.tools) {
    for (const field of ['name', 'title', 'summary', 'description', 'page']) {
      assert.ok(tool[field], `${tool.name || '?'} is missing ${field}`);
    }
    assert.ok(Array.isArray(tool.aliases) && tool.aliases.length, `${tool.name} has no aliases`);
    assert.ok(tool.keywords && tool.keywords.action && tool.keywords.subject,
      `${tool.name} needs keywords.action and keywords.subject`);
    assert.ok(Array.isArray(tool.params) && tool.params.length, `${tool.name} has no params`);
  }
});

test('every parameter is a type all three runtimes implement', () => {
  const supported = new Set(['enum', 'integer', 'color']);
  for (const tool of manifest.tools) {
    for (const param of tool.params) {
      assert.ok(param.name, `${tool.name} has an unnamed param`);
      assert.ok(supported.has(param.type),
        `${tool.name}.${param.name} is type "${param.type}" — teach nlp.js, toolkit.js and registry.py first`);
      assert.ok(param.description, `${tool.name}.${param.name} has no description`);

      if (param.type === 'enum') {
        assert.ok(Array.isArray(param.values) && param.values.length,
          `${tool.name}.${param.name} has no values`);
        for (const target of Object.values(param.aliases || {})) {
          assert.ok(param.values.includes(target),
            `${tool.name}.${param.name} aliases "${target}", which is not a value`);
        }
      }

      if (param.type === 'integer') {
        assert.equal(typeof param.min, 'number', `${tool.name}.${param.name} has no min`);
        assert.equal(typeof param.max, 'number', `${tool.name}.${param.name} has no max`);
        assert.ok(param.min < param.max, `${tool.name}.${param.name} has min >= max`);
      }

      if (!param.required) {
        assert.notEqual(param.default, undefined,
          `${tool.name}.${param.name} is optional but has no default`);
      }
    }
  }
});

test('an optional default is itself a legal value', () => {
  /* A default outside its own bounds would be accepted by every
     validator, because defaults are filled in rather than checked. */
  for (const tool of manifest.tools) {
    for (const param of tool.params) {
      if (param.required || param.default === undefined) continue;
      if (param.type === 'enum') {
        assert.ok(param.values.includes(param.default),
          `${tool.name}.${param.name} defaults to "${param.default}", not one of its values`);
      }
      if (param.type === 'integer') {
        assert.ok(param.default >= param.min && param.default <= param.max,
          `${tool.name}.${param.name} defaults outside its own bounds`);
      }
      if (param.type === 'color') {
        assert.match(String(param.default), /^#[0-9a-f]{6}$/,
          `${tool.name}.${param.name} defaults to a non-hex colour`);
      }
    }
  }
});

test('image_convert declares encoder metadata for every format it offers', () => {
  const tool = manifest.tools.find(t => t.name === 'image_convert');
  const format = tool.params.find(p => p.name === 'format');
  const formats = tool.meta.formats;

  for (const value of format.values) {
    const spec = formats[value];
    assert.ok(spec, `no meta.formats entry for ${value}`);
    assert.match(spec.mime, /^image\//, `${value} has no image mime type`);
    assert.ok(spec.ext, `${value} has no file extension`);
    assert.equal(typeof spec.alpha, 'boolean', `${value} does not say whether it keeps alpha`);
    assert.equal(typeof spec.lossy, 'boolean', `${value} does not say whether it is lossy`);
  }

  /* The background argument only exists to flatten transparency, so it
     must apply to exactly the formats that cannot store it. */
  const background = tool.params.find(p => p.name === 'background');
  const noAlpha = format.values.filter(v => !formats[v].alpha);
  assert.deepEqual([...background.appliesTo].sort(), noAlpha.sort());

  const lossy = format.values.filter(v => formats[v].lossy);
  const quality = tool.params.find(p => p.name === 'quality');
  assert.deepEqual([...quality.appliesTo].sort(), lossy.sort());
});

test('every tool page named by the spec exists on disk', () => {
  for (const tool of manifest.tools) {
    assert.ok(fs.existsSync(path.join(ROOT, tool.page)),
      `${tool.name} points at ${tool.page}, which does not exist`);
  }
});

test('the documented examples actually parse to what they claim', () => {
  /* The examples are shown to visitors and fed to the assistant's
     capability reply, so a stale one is a lie in the UI. */
  const { loadPure } = require('./helpers/load-pure');
  const { parseIntent } = loadPure('nlp.js', ['parseIntent']);

  for (const tool of manifest.tools) {
    for (const example of tool.examples || []) {
      const got = parseIntent(example.text, manifest);
      assert.equal(got.tool, tool.name, `example "${example.text}" does not select ${tool.name}`);
      assert.deepEqual(got.args, example.args, `example "${example.text}" parses differently`);
    }
  }
});
