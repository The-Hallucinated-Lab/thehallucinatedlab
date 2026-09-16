/* ============================================================
   home.test.js — the pure helpers behind the homepage hero and the
   Software / ML / AI selector. Drafted by the local tester expert from a
   packet; accepted after every stubbed function failed its tests.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const { petalOffset, lotusPhase, nextTabIndex } = loadPure('home.js', ['petalOffset', 'lotusPhase', 'nextTabIndex']);

test('petalOffset is zero when dx and dy are zero', () => {
  assert.deepEqual(petalOffset(0, 0, 220), { x: 0, y: 0 });
});

test('petalOffset is proportional when dx and dy are non-zero', () => {
  assert.deepEqual(petalOffset(110, -55, 220), { x: 0.5, y: -0.25 });
});

test('petalOffset is clamped high when dx and dy exceed half', () => {
  assert.deepEqual(petalOffset(900, -900, 220), { x: 1, y: -1 });
});

test('petalOffset is clamped low when dx and dy are below half', () => {
  assert.deepEqual(petalOffset(-330, 0, 220), { x: -1, y: 0 });
});

test('petalOffset returns zero for invalid half values', () => {
  assert.deepEqual(petalOffset(110, -55, 0), { x: 0, y: 0 });
  assert.deepEqual(petalOffset(110, -55, -220), { x: 0, y: 0 });
  assert.deepEqual(petalOffset(110, -55, NaN), { x: 0, y: 0 });
  assert.deepEqual(petalOffset(110, -55, undefined), { x: 0, y: 0 });
});

test('lotusPhase is 0 until a fifth of the hero has scrolled', () => {
  assert.ok(Math.abs(lotusPhase(0, 800) - 0) < 1e-9);
});

test('lotusPhase is 0 exactly at start', () => {
  assert.ok(Math.abs(lotusPhase(160, 800) - 0) < 1e-9);
});

test('lotusPhase is 0.5 halfway between start and end', () => {
  assert.ok(Math.abs(lotusPhase(440, 800) - 0.5) < 1e-9);
});

test('lotusPhase is 1 exactly at end', () => {
  assert.ok(Math.abs(lotusPhase(720, 800) - 1) < 1e-9);
});

test('lotusPhase is 1 beyond the end', () => {
  assert.ok(Math.abs(lotusPhase(5000, 800) - 1) < 1e-9);
});

test('lotusPhase is 0 for negative scrollY', () => {
  assert.ok(Math.abs(lotusPhase(-50, 800) - 0) < 1e-9);
});

test('lotusPhase returns 0 for invalid heroHeight values', () => {
  assert.ok(Math.abs(lotusPhase(160, 0) - 0) < 1e-9);
  assert.ok(Math.abs(lotusPhase(160, -800) - 0) < 1e-9);
  assert.ok(Math.abs(lotusPhase(160, NaN) - 0) < 1e-9);
  assert.ok(Math.abs(lotusPhase(160, undefined) - 0) < 1e-9);
});

test('nextTabIndex wraps right/down to 0 after count - 1', () => {
  assert.strictEqual(nextTabIndex('ArrowRight', 2, 3), 0);
});

test('nextTabIndex wraps left/up to count - 1 before 0', () => {
  assert.strictEqual(nextTabIndex('ArrowLeft', 0, 3), 2);
});

test('nextTabIndex wraps down/up to 1', () => {
  assert.strictEqual(nextTabIndex('ArrowDown', 0, 3), 1);
});

test('nextTabIndex wraps up/down to 0', () => {
  assert.strictEqual(nextTabIndex('ArrowUp', 1, 3), 0);
});

test('nextTabIndex goes to 0 for Home', () => {
  assert.strictEqual(nextTabIndex('Home', 2, 3), 0);
});

test('nextTabIndex goes to count - 1 for End', () => {
  assert.strictEqual(nextTabIndex('End', 0, 3), 2);
});

test('nextTabIndex remains unchanged for unrelated keys', () => {
  assert.strictEqual(nextTabIndex('Enter', 1, 3), 1);
});

test('nextTabIndex returns current for count <= 0', () => {
  assert.strictEqual(nextTabIndex('ArrowRight', 0, 0), 0);
});
