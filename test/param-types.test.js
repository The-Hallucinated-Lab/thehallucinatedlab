/* ============================================================
   param-types.test.js — the param types the RAG toolchain added.

   convert only ever needed enum, integer and colour. extract, chunk,
   tokenize, embed and index need strings, paths, booleans and floats,
   and both runtimes had to learn them at once: the manifest is one file,
   so a type the browser accepts and Python rejects is a tool that works
   on the site and fails in a script.

   These use synthetic tools rather than the real manifest on purpose —
   the point is the type system itself, and tying it to whichever tool
   currently happens to declare a boolean would make the coverage move
   every time a manifest entry is edited.

   The Python twin of this file is python/tests/test_param_types.py. The
   two assert the same behaviours; when one changes, so must the other.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const { validateArgs, describeParams } =
  loadPure('toolkit.js', ['validateArgs', 'describeParams']);

/* One synthetic tool carrying every new type. */
const tool = {
  name: 'synthetic',
  params: [
    { name: 'title', type: 'string', required: true, description: 'a string' },
    { name: 'slug', type: 'string', required: false, default: 'notes',
      pattern: '[a-z0-9-]+', maxLength: 12, description: 'a constrained string' },
    { name: 'source', type: 'path', required: true, description: 'a filesystem path' },
    { name: 'tables', type: 'boolean', required: false, default: true, description: 'a flag' },
    { name: 'overlap', type: 'number', required: false, default: 0.25,
      min: 0, max: 1, description: 'a ratio' },
  ],
};

const ok = extra => validateArgs(
  Object.assign({ title: 'Report', source: 'a.pdf' }, extra), tool);

/* ---- string ---- */

test('a string is accepted and trimmed', () => {
  const result = ok({ title: '  Report  ' });
  assert.ok(result.ok, result.errors.join(' '));
  assert.equal(result.args.title, 'Report');
});

test('a required string cannot be whitespace only', () => {
  /* "   " is not blank by isBlank(), so it reaches the type branch —
     which is the only thing standing between it and a document titled
     with three spaces. */
  const result = validateArgs({ title: '   ', source: 'a.pdf' }, tool);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('title')), result.errors.join(' '));
});

test('a string pattern is anchored, so a partial match is rejected', () => {
  assert.equal(ok({ slug: 'my-notes' }).ok, true);
  assert.equal(ok({ slug: 'My Notes' }).ok, false);
  /* Would pass an unanchored /[a-z0-9-]+/ by matching the "ok" inside. */
  assert.equal(ok({ slug: 'NOT_ok!' }).ok, false);
});

test('maxLength is enforced', () => {
  assert.equal(ok({ slug: 'a'.repeat(12) }).ok, true);
  assert.equal(ok({ slug: 'a'.repeat(13) }).ok, false);
});

/* ---- path ---- */

test('a path is required and must not be empty', () => {
  const result = validateArgs({ title: 'Report' }, tool);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('source is required')), result.errors.join(' '));
});

/* ---- boolean ---- */

test('booleans accept the spellings a form or a CLI actually produces', () => {
  for (const truthy of [true, 'true', 'TRUE', 'yes', 'on', '1']) {
    assert.equal(ok({ tables: truthy }).args.tables, true, String(truthy));
  }
  for (const falsy of [false, 'false', 'FALSE', 'no', 'off', '0']) {
    assert.equal(ok({ tables: falsy }).args.tables, false, String(falsy));
  }
});

test('an explicit false is kept, not overwritten by the default', () => {
  /* The trap: if false were treated as "not supplied", every boolean
     with default true could never be turned off. */
  const result = ok({ tables: false });
  assert.ok(result.ok, result.errors.join(' '));
  assert.equal(result.args.tables, false);
});

test('a boolean that is neither is an error, not a silent false', () => {
  const result = ok({ tables: 'maybe' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('true or false')), result.errors.join(' '));
});

/* ---- number ---- */

test('a number accepts fractions, unlike integer', () => {
  const result = ok({ overlap: 0.15 });
  assert.ok(result.ok, result.errors.join(' '));
  assert.equal(result.args.overlap, 0.15);
});

test('number bounds are enforced at both ends', () => {
  assert.equal(ok({ overlap: 0 }).ok, true);
  assert.equal(ok({ overlap: 1 }).ok, true);
  assert.equal(ok({ overlap: -0.1 }).ok, false);
  assert.equal(ok({ overlap: 1.1 }).ok, false);
});

test('a non-numeric value is rejected rather than becoming NaN', () => {
  const result = ok({ overlap: 'loads' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('must be a number')), result.errors.join(' '));
});

/* ---- unknown ---- */

test('an unrecognised type passes through in the browser, deliberately', () => {
  /* The one place the two runtimes disagree on purpose, and the reason
     is a real asymmetry rather than drift.

     The browser FETCHES spec/manifest.json at runtime, so a cached
     toolkit.js can legitimately be older than the spec it is reading.
     Failing closed there would break the page on a spec change the
     Python package already handles — so an unknown type is passed
     through and the tool decides.

     Python cannot skew: the manifest ships inside the wheel, so the two
     always move together. An unknown type there is a typo in the
     manifest, and test_param_types.py asserts it raises.

     If this ever needs revisiting, revisit both together. */
  const ahead = { name: 'x', params: [{ name: 'n', type: 'duration', required: true, description: 'd' }] };
  const result = validateArgs({ n: '30s' }, ahead);
  assert.equal(result.ok, true, result.errors.join(' '));
  assert.equal(result.args.n, '30s');
});

/* ---- defaults ---- */

test('defaults are filled in for every new type', () => {
  const result = ok({});
  assert.ok(result.ok, result.errors.join(' '));
  assert.equal(result.args.slug, 'notes');
  assert.equal(result.args.tables, true);
  assert.equal(result.args.overlap, 0.25);
});

/* ============================================================
   list and mapping — added by the EDA tools.

   A profiler takes "which columns" and "read this column as that type",
   and both arrive as one shell word: --columns a,b,c and
   --types zip=categorical_high. Neither fits an existing type, and
   neither should force the caller to split a string before calling the
   Python API with a real list or dict.

   Same rule as the types above: what the browser accepts, Python must
   accept identically, or a tool works on the site and fails in a script.
   The twin cases are in python/tests/test_param_types.py.
   ============================================================ */

const collections = {
  name: 'collections',
  params: [
    { name: 'columns', type: 'list', required: false, default: null, description: 'a list' },
    { name: 'types', type: 'mapping', required: false, default: null, description: 'a mapping' },
  ],
};

const coll = extra => validateArgs(extra, collections);

test('a list is accepted as a comma-separated string and trimmed', () => {
  const result = coll({ columns: ' revenue , region ,city ' });
  assert.ok(result.ok, result.errors.join(' '));
  assert.deepEqual(result.args.columns, ['revenue', 'region', 'city']);
});

test('a list is accepted as a real array', () => {
  const result = coll({ columns: ['revenue', 'region'] });
  assert.ok(result.ok, result.errors.join(' '));
  assert.deepEqual(result.args.columns, ['revenue', 'region']);
});

test('empty entries in a list are dropped rather than kept as blanks', () => {
  const result = coll({ columns: 'revenue,,region,' });
  assert.ok(result.ok, result.errors.join(' '));
  assert.deepEqual(result.args.columns, ['revenue', 'region']);
});

test('a list of nothing but separators is an error, not an empty list', () => {
  const result = coll({ columns: ',,,' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /at least one value/);
});

test('a mapping is accepted as key=value pairs and trimmed', () => {
  const result = coll({ types: ' zip = categorical_high , year=numeric_discrete ' });
  assert.ok(result.ok, result.errors.join(' '));
  assert.deepEqual(result.args.types, { zip: 'categorical_high', year: 'numeric_discrete' });
});

test('a mapping is accepted as a real object', () => {
  const result = coll({ types: { zip: 'categorical_high' } });
  assert.ok(result.ok, result.errors.join(' '));
  assert.deepEqual(result.args.types, { zip: 'categorical_high' });
});

test('a mapping entry with no = is reported rather than read as a bare key', () => {
  const result = coll({ types: 'zip=categorical_high,oops' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /key=value/);
});

test('a mapping entry with no key is reported', () => {
  const result = coll({ types: '=value' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /key=value/);
});

test('a value containing = keeps everything after the first one', () => {
  /* A pattern or a formula is a legitimate value. Splitting on every =
     would silently truncate it. */
  const result = coll({ types: 'expr=a=b' });
  assert.ok(result.ok, result.errors.join(' '));
  assert.deepEqual(result.args.types, { expr: 'a=b' });
});

test('a null default means detected, not the string "null"', () => {
  /* Distinct from an absent default, which means there is none at all.
     describeParams renders it, so the argument table says which. */
  const rows = describeParams(collections);
  assert.equal(rows.find(r => r.name === 'columns').fallback, 'detected');
  assert.equal(rows.find(r => r.name === 'columns').type, 'comma-separated list');
  assert.equal(rows.find(r => r.name === 'types').type, 'key=value pairs');
});
