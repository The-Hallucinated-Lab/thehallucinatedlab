/* ============================================================
   nlp.test.js — drives the intent parser through the shared fixtures.

   The cases live in spec/nlp-fixtures.json rather than in this file
   because python/tests/test_nlp.py runs the exact same list. That is the
   only thing keeping two independent parser implementations honest: a
   phrasing taught to one and not the other turns this suite red.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const manifest = readJSON('spec/manifest.json');
const fixtures = readJSON('spec/nlp-fixtures.json');

const { parseIntent, tokenize, expandHex, mergeAnswer } = loadPure('nlp.js', [
  'parseIntent', 'tokenize', 'expandHex', 'mergeAnswer',
]);

test('every shared fixture parses to the agreed result', () => {
  for (const { input, expect } of fixtures.cases) {
    const got = parseIntent(input, manifest);
    assert.equal(got.tool, expect.tool, `tool mismatch for ${JSON.stringify(input)}`);
    assert.deepEqual(got.args, expect.args, `args mismatch for ${JSON.stringify(input)}`);
    assert.deepEqual(got.missing, expect.missing, `missing mismatch for ${JSON.stringify(input)}`);
  }
});

test('the fixture file covers both matches and non-matches', () => {
  /* A suite of nothing but happy paths would let the confidence
     threshold drift to zero unnoticed. */
  const matched = fixtures.cases.filter(c => c.expect.tool !== null).length;
  const rejected = fixtures.cases.length - matched;
  assert.ok(matched >= 20, `only ${matched} matching fixtures`);
  assert.ok(rejected >= 5, `only ${rejected} non-matching fixtures`);
});

test('a matched tool always names a tool that exists in the manifest', () => {
  const names = new Set(manifest.tools.map(t => t.name));
  for (const { expect } of fixtures.cases) {
    if (expect.tool !== null) assert.ok(names.has(expect.tool), `unknown tool ${expect.tool}`);
  }
});

test('confidence never exceeds 1 and clears the threshold on a match', () => {
  for (const { input, expect } of fixtures.cases) {
    const got = parseIntent(input, manifest);
    assert.ok(got.confidence <= 1, `${input} scored ${got.confidence}`);
    if (expect.tool !== null) {
      assert.ok(got.confidence >= manifest.scoring.threshold, `${input} scored ${got.confidence}`);
    }
  }
});

test('tokenizer keeps hex codes and percentages intact', () => {
  assert.deepEqual(tokenize('#f00 and #123456'), ['#f00', 'and', '#123456']);
  assert.deepEqual(tokenize('quality=60'), ['quality', '60']);
  assert.deepEqual(tokenize('at 50%'), ['at', '50%']);
});

test('short hex expands to the long form', () => {
  assert.equal(expandHex('#f00'), '#ff0000');
  assert.equal(expandHex('#123456'), '#123456');
  assert.equal(expandHex('#zzz'), null);
  assert.equal(expandHex('png'), null);
});

test('a follow-up answer completes a parse that stalled on a missing slot', () => {
  const pending = parseIntent('convert this image', manifest);
  assert.deepEqual(pending.missing, ['format']);

  const merged = mergeAnswer(pending, 'png', manifest);
  assert.equal(merged.tool, 'convert');
  assert.deepEqual(merged.args, { format: 'png' });
  assert.deepEqual(merged.missing, []);
});

test('a follow-up keeps arguments already gathered', () => {
  const pending = parseIntent('convert my photo at 70 quality', manifest);
  assert.deepEqual(pending.args, { quality: 70 });

  const merged = mergeAnswer(pending, 'jpg', manifest);
  assert.deepEqual(merged.args, { format: 'jpeg', quality: 70 });
  assert.deepEqual(merged.missing, []);
});

test('parsing is defensive about junk input', () => {
  for (const junk of [null, undefined, '', '   ', 12345, {}]) {
    const got = parseIntent(junk, manifest);
    assert.equal(got.tool, null);
    assert.deepEqual(got.args, {});
  }
});
