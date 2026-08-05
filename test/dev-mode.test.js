/* ============================================================
   dev-mode.test.js — the dev/live split.

   The property worth protecting is asymmetric: showing unfinished work to
   a visitor is a real failure, while failing to show it to a founder is a
   minor annoyance. Every test here is written from the direction of "can
   dev content escape", not "does the toggle work".

   The CSS carries the hiding rule rather than the JS, deliberately: the
   CSP forbids inline script, so the earliest JS can run is a deferred
   file, which is after paint. A "hide when live" rule would flash
   unfinished work at every visitor before JS could remove it.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('styles.css');
const js = read('script.js');
const manifest = JSON.parse(read('spec/manifest.json'));

const { normalizeMode, navEntryVisible } = loadPure('script.js', ['normalizeMode', 'navEntryVisible']);

test('dev content is hidden by default, not hidden by script', () => {
  assert.match(css, /\[data-status="dev"\]\s*\{\s*display:\s*none\s*!important/,
    'dev content must default to hidden in CSS, or it flashes before JS runs');
});

test('only data-mode="dev" reveals it', () => {
  assert.match(css, /:root\[data-mode="dev"\]\s*\[data-status="dev"\]\s*\{\s*display:\s*revert/,
    'the reveal must be gated on the mode attribute');
});

test('script cannot unhide dev content by stripping the marker', () => {
  /* JS may only add data-mode. If it could remove data-status, a bug
     there would expose everything at once. */
  assert.doesNotMatch(js, /removeAttribute\(\s*['"]data-status['"]\s*\)/,
    'script must not remove the dev marker');
});

test('anything unrecognised resolves to live', () => {
  assert.equal(normalizeMode(null), 'live', 'no stored value means live');
  assert.equal(normalizeMode(undefined), 'live', 'undefined means live');
  assert.equal(normalizeMode(''), 'live', 'empty means live');
  assert.equal(normalizeMode('nonsense'), 'live', 'an unknown value means live');
  assert.equal(normalizeMode('DEV'), 'live', 'case must not smuggle dev mode in');
  assert.equal(normalizeMode('dev'), 'dev', 'the exact value is honoured');
});

test('the founder hashes are digests, not keys', () => {
  const block = js.match(/const FOUNDER_HASHES = \[([\s\S]*?)\];/);
  assert.ok(block, 'FOUNDER_HASHES not found');
  const hashes = [...block[1].matchAll(/'([0-9a-f]+)'/g)].map(m => m[1]);
  assert.ok(hashes.length >= 2, 'expected one hash per founder');
  for (const h of hashes) {
    assert.equal(h.length, 64, 'a SHA-256 hex digest is 64 characters');
  }
});

test('every tool declares a status the site can filter on', () => {
  for (const tool of manifest.tools) {
    assert.ok(['live', 'dev'].includes(tool.status),
      `${tool.name} has status ${JSON.stringify(tool.status)}; expected "live" or "dev"`);
  }
});

test('nav entries default to live and dev entries need dev mode', () => {
  assert.equal(navEntryVisible({ label: 'Convert' }, 'live'), true, 'no status means live');
  assert.equal(navEntryVisible({ label: 'X', status: 'dev' }, 'live'), false,
    'a dev entry must not render in live mode');
  assert.equal(navEntryVisible({ label: 'X', status: 'dev' }, 'dev'), true,
    'dev mode reveals dev entries');
  assert.equal(navEntryVisible({ label: 'Y', status: 'live' }, 'live'), true,
    'an explicit live entry renders');
});
