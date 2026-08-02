/**
 * Test harness for duochat's browser-global JSX components.
 *
 * duochat.html loads React/ReactDOM as UMD globals from a CDN, then loads each
 * .jsx via <script type="text/babel">. Those are CLASSIC scripts, not modules:
 * they declare components at top level and publish them with
 * Object.assign(window, {...}). Nothing is ever exported.
 *
 * So we cannot require() them. Instead we rebuild the same environment --
 * jsdom for the DOM, React on the global, Babel for the JSX transform -- and
 * evaluate each file in a shared global scope, in the same order as the HTML.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const { JSDOM } = require('jsdom');

const DUOCHAT_DIR = path.join(__dirname, '..', 'duochat');

// Mirrors the <script> order in duochat.html. Order matters: later files
// reference globals declared by earlier ones.
// app.jsx is intentionally excluded -- it is the bootstrap that renders into
// #root, and running it would mount the whole app during every test.
const LOAD_ORDER = [
  'ios-frame.jsx',
  'tweaks-panel.jsx',
  'chat.jsx',
  'screens.jsx',
  'media.jsx',
  'read.jsx',
  'explore.jsx',
];

let loaded = false;

/**
 * Some globals (notably `navigator` on Node 18+) are defined as read-only
 * getters, so a plain assignment throws. Fall back to defineProperty.
 */
function setGlobal(key, value) {
  try {
    global[key] = value;
  } catch {
    try {
      Object.defineProperty(global, key, { value, configurable: true, writable: true });
    } catch {
      /* Node owns this one and won't let go; jsdom's copy is unreachable. */
    }
  }
}

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);

  // Copy DOM constructors (HTMLElement, Event, Node, ...) onto the Node global
  // so instanceof checks inside React and Testing Library resolve correctly.
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key.startsWith('_')) continue;
    if (key in global) continue;
    setGlobal(key, dom.window[key]);
  }

  // React 18 requires this flag before act()/render, or it warns and misbehaves.
  global.IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

/**
 * Transform a .jsx file and run it in the current global context, reproducing
 * classic-script semantics: top-level declarations become globals, visible to
 * every file loaded afterwards.
 */
function runScript(file) {
  const full = path.join(DUOCHAT_DIR, file);
  const source = fs.readFileSync(full, 'utf8');

  const { code } = babel.transformSync(source, {
    filename: full,
    // 'classic' matches the CDN setup, where JSX compiles to React.createElement
    // against the React global rather than importing a jsx-runtime module.
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    babelrc: false,
    configFile: false,
  });

  vm.runInThisContext(code, { filename: full });
}

/**
 * Build the environment and load the components. Returns the jsdom window,
 * on which every component has been published.
 */
function loadDuochat() {
  if (loaded) return global.window;

  setupDom();

  const React = require('react');
  const ReactDOM = require('react-dom');
  setGlobal('React', React);
  setGlobal('ReactDOM', ReactDOM);
  global.window.React = React;
  global.window.ReactDOM = ReactDOM;

  // data.js is a plain script that sets window.DUOCHAT_DATA; components read it
  // as their default data source, so it must exist before they load.
  vm.runInThisContext(fs.readFileSync(path.join(DUOCHAT_DIR, 'data.js'), 'utf8'), {
    filename: 'data.js',
  });

  for (const file of LOAD_ORDER) runScript(file);

  loaded = true;
  return global.window;
}

module.exports = {
  loadDuochat,
  LOAD_ORDER,
  // Tests are plain .js (no JSX transform on the test files themselves), so
  // this alias keeps element construction readable.
  h: (...args) => require('react').createElement(...args),
};
