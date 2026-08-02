/**
 * Verifies the harness itself: that every .jsx file evaluates cleanly, that the
 * components reach the window the way duochat.html expects, and that one of
 * them actually mounts. If this file fails, no other test can be trusted.
 */
const test = require('node:test');
const assert = require('node:assert');
const { loadDuochat, h } = require('./harness.js');

const win = loadDuochat();

// Testing Library reads the global document, so it can only be required after
// the harness has installed the jsdom globals.
const { render, cleanup } = require('@testing-library/react');

test.afterEach(() => cleanup());

test('mock data is available before components load', () => {
  assert.ok(win.DUOCHAT_DATA, 'window.DUOCHAT_DATA should be set by data.js');
});

test('chat.jsx publishes its components', () => {
  for (const name of ['ChatScreen', 'DiscussionPanel', 'MessageBody']) {
    assert.strictEqual(typeof win[name], 'function', `window.${name} should be a component`);
  }
});

test('every screen component is published', () => {
  for (const name of ['MediaScreen', 'ReadScreen', 'ExploreScreen']) {
    assert.strictEqual(typeof win[name], 'function', `window.${name} should be a component`);
  }
});

test('ChatScreen mounts without throwing', () => {
  const { container } = render(h(win.ChatScreen));
  assert.ok(container.textContent.length > 0, 'ChatScreen should render visible content');
});
