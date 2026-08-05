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

const { validateArgs } = loadPure('toolkit.js', ['validateArgs']);

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
