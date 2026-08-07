/* ============================================================
   toolbench.test.js — the command builder must build commands that
   actually work.

   This exists because the first version did not. The manifest names
   arguments the way Python binds them (max_tokens, page_markers); the
   CLI spells the same arguments --max-tokens and --no-page-markers.
   Rendering the manifest name straight into a shell command produced
   `thl tool chunk file --max_tokens 512`, which argparse rejects.

   It looked right. Every flag was present, spelled almost correctly,
   and no test covered it — which is exactly the shape of a
   documentation bug that ships and then sits there being copied.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadPure } = require('./helpers/load-pure');

const bench = loadPure('toolbench.js', [
  'terminalText', 'pythonText', 'applicable', 'isInteresting', 'defaultsFor', 'runArgs',
]);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'manifest.json'), 'utf8'));
const cli = fs.readFileSync(path.join(ROOT, 'python', 'thehallucinatedlab', 'cli.py'), 'utf8');

/* Every long option argparse actually defines. Read out of the source
   rather than restated, so a renamed flag shows up here as a failure
   instead of as agreement between two stale copies. */
const CLI_FLAGS = new Set(
  [...cli.matchAll(/"(--[a-z][a-z-]*)"/g)].map((m) => m[1]),
);

/* The tools whose pages mount the builder. Read from the pages, so
   mounting it somewhere new without checking is itself a failure. */
function mountedTools() {
  const names = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of html.matchAll(/data-toolbench="([a-z_]+)"/g)) names.push(m[1]);
  }
  return [...new Set(names)];
}

const toolFor = (name) => manifest.tools.find((t) => t.name === name);

test('every page that mounts the builder names a tool the spec knows', () => {
  const unknown = mountedTools().filter((n) => !toolFor(n));
  assert.deepEqual(unknown, [], 'these mounts name a tool absent from the manifest');
});

test('every flag the builder can emit is a flag the CLI defines', () => {
  const problems = [];

  for (const name of mountedTools()) {
    const tool = toolFor(name);
    const params = tool.params || [];

    // Walk every value a control can take, not just the defaults: a flag
    // that only appears once a dropdown moves is still a flag someone
    // copies.
    const cases = [bench.defaultsFor(tool)];
    for (const p of params) {
      const base = bench.defaultsFor(tool);
      if (p.type === 'boolean') {
        cases.push({ ...base, [p.name]: !p.default });
      } else if (p.type === 'enum') {
        for (const v of p.values || []) cases.push({ ...base, [p.name]: v });
      } else if (p.type === 'integer' || p.type === 'number') {
        const bumped = (p.default ?? p.min ?? 1) + 1;
        cases.push({ ...base, [p.name]: bumped });
      } else {
        cases.push({ ...base, [p.name]: 'x' });
      }
    }

    for (const values of cases) {
      const text = bench.terminalText(tool, values, 'input.dat');
      for (const flag of text.match(/--[a-z][a-z-]*/g) || []) {
        if (!CLI_FLAGS.has(flag)) {
          problems.push(`${name}: emits ${flag}, which the CLI does not define`);
        }
      }
    }
  }

  assert.deepEqual(
    [...new Set(problems)], [],
    'The builder would print a command that argparse rejects.\n' +
    'The manifest uses Python argument names (max_tokens); the CLI uses\n' +
    'the argparse spelling (--max-tokens). Convert, do not restate.',
  );
});

test('the command always starts with the namespaced form', () => {
  for (const name of mountedTools()) {
    const tool = toolFor(name);
    const text = bench.terminalText(tool, bench.defaultsFor(tool), 'input.dat');
    assert.ok(
      text.startsWith(`thl tool ${name} `),
      `${name}: builder emits "${text.split('\n')[0]}" — 1.0 namespaced every tool`,
    );
  }
});

test('a value left at its default is not printed', () => {
  // Echoing defaults back teaches that they must be stated, which is the
  // opposite of true, and turns a one-flag command into a wall.
  for (const name of mountedTools()) {
    const tool = toolFor(name);
    const text = bench.terminalText(tool, bench.defaultsFor(tool), 'input.dat');
    for (const p of tool.params || []) {
      if (p.required || p.default === undefined) continue;
      assert.ok(
        !text.includes(`--${p.name.replace(/_/g, '-')} ${p.default}`),
        `${name}: prints --${p.name} at its default value`,
      );
    }
  }
});

test('the python form keeps the underscore names the library binds', () => {
  for (const name of mountedTools()) {
    const tool = toolFor(name);
    const withAll = bench.defaultsFor(tool);
    for (const p of tool.params || []) {
      if (p.type === 'boolean') withAll[p.name] = !p.default;
    }
    const code = bench.pythonText(tool, withAll, 'input.dat');
    assert.ok(code.startsWith(`result = thl.${name}(`), `${name}: unexpected call shape`);
    assert.ok(!/-\w+=/.test(code), `${name}: python form must not use hyphenated keywords`);
  }
});

test('an argument that does not apply is not offered', () => {
  // convert is the case that exists today: --quality and --background do
  // nothing for PNG, and a command showing them is a command that lies.
  const convert = toolFor('convert');
  if (!convert) return;
  const png = bench.applicable(convert.params, { format: 'png' }).map((p) => p.name);
  const jpeg = bench.applicable(convert.params, { format: 'jpeg' }).map((p) => p.name);
  assert.ok(!png.includes('quality'), 'quality is meaningless for lossless png');
  assert.ok(jpeg.includes('quality'), 'quality applies to jpeg');
});

/* ============================================================
   The live builder: what is shown and what is run.

   The builder stopped being a picture of a command and became the
   command — on convert.html it is now the only interface, and dropping a
   file executes the line on screen. That makes one thing critical that
   was merely tidy before: the arguments handed to the runtime have to be
   the arguments the visible command is advertising.

   If those two ever diverge, the page shows `--format png` and produces
   a JPEG, and every claim the site makes about documentation that
   cannot drift is false in the most convincing way possible — because
   the wrong command is right there on screen looking correct.
   ============================================================ */

test('what runs is what the command line says, argument for argument', () => {
  for (const name of mountedTools()) {
    const tool = toolFor(name);
    const params = tool.params || [];

    const cases = [bench.defaultsFor(tool)];
    for (const p of params) {
      const base = bench.defaultsFor(tool);
      if (p.type === 'enum') for (const v of p.values || []) cases.push({ ...base, [p.name]: v });
      else if (p.type === 'integer' || p.type === 'number') {
        cases.push({ ...base, [p.name]: (p.default ?? p.min ?? 1) + 1 });
      } else if (p.type === 'boolean') cases.push({ ...base, [p.name]: !p.default });
    }

    for (const values of cases) {
      const args = bench.runArgs(tool, values);
      const shown = bench.applicable(params, values).map(p => p.name);

      // Nothing is run that the command does not show.
      for (const key of Object.keys(args)) {
        assert.ok(shown.includes(key),
          `${name}: would run with ${key}, which the command line does not show`);
      }
      // And nothing shown with a value is quietly dropped on the way in.
      for (const p of bench.applicable(params, values)) {
        const v = values[p.name];
        if (v === undefined || v === null || v === '') continue;
        assert.equal(args[p.name], v,
          `${name}: shows ${p.name}=${v} but would run with ${args[p.name]}`);
      }
    }
  }
});

test('an argument that does not apply is never handed to the runtime', () => {
  // The case that exists today: quality is meaningless for lossless PNG,
  // and passing it anyway would be rejected by validateArgs as an
  // argument the tool does not accept for that format.
  const convert = toolFor('convert');
  if (!convert) return;
  const args = bench.runArgs(convert, { ...bench.defaultsFor(convert), format: 'png' });
  assert.ok(!('quality' in args), 'quality must not be sent for png');
  assert.ok(!('background' in args), 'background must not be sent for png');
  assert.equal(args.format, 'png');
});
