/* ============================================================
   chunk.test.js — the splitting logic behind chunk.html.

   The DOM half needs a browser. This covers everything that decides
   where a chunk begins and ends, which is the part that must agree with
   the Python implementation: a document chunked in the browser and the
   same document chunked by the package have to produce the same
   records, or they embed differently and retrieve differently.

   spec/chunk-fixtures.json is run by both suites.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/chunk-fixtures.json'), 'utf8'));

const { estimateTokens } = loadPure('toolkit.js', ['estimateTokens']);
const {
  parseFrontmatter, parseBlocks, splitText, tail, pack, toJsonl,
  overlapProblem, outputName,
} = loadPure('chunk.js', [
  'parseFrontmatter', 'parseBlocks', 'splitText', 'tail', 'pack', 'toJsonl',
  'overlapProblem', 'outputName',
]);

const count = estimateTokens;

/* ---- the shared contract ---- */

test('every shared fixture chunks to exactly the documented records', () => {
  for (const c of fixtures.cases) {
    const parsed = parseFrontmatter(c.document);
    const blocks = parseBlocks(parsed.body);
    const got = pack(blocks, {
      max_tokens: c.args.max_tokens,
      overlap: c.args.overlap,
      heading_context: c.args.heading_context,
      count: count,
      tokenizer: fixtures.tokenizer,
      source: parsed.meta.source || 'input.md',
    });
    assert.deepEqual(got, c.expected, c.name);
  }
});

/* ---- frontmatter ---- */

test('frontmatter is split off, with numbers left as numbers', () => {
  const { meta, body } = parseFrontmatter('---\nsource: "a.pdf"\npages: 3\n---\n\n# T\n');
  assert.equal(meta.source, 'a.pdf');
  assert.equal(meta.pages, 3);
  assert.ok(!body.startsWith('---'));
});

test('a document without frontmatter is left alone', () => {
  const { meta, body } = parseFrontmatter('# Title\n\nBody.\n');
  assert.deepEqual(meta, {});
  assert.ok(body.startsWith('# Title'));
});

test('escaped quotes in frontmatter round trip', () => {
  const { meta } = parseFrontmatter('---\nsource: "we\\"ird\\".pdf"\n---\n\nBody.\n');
  assert.equal(meta.source, 'we"ird".pdf');
});

/* ---- structure ---- */

test('a deeper heading nests and a shallower one pops', () => {
  const blocks = parseBlocks('# A\n\nunder a\n\n## B\n\nunder b\n\n# C\n\nunder c\n');
  const byText = Object.fromEntries(blocks.map(b => [b.text, b.path]));
  assert.deepEqual(byText['under a'], ['A']);
  assert.deepEqual(byText['under b'], ['A', 'B']);
  /* C is a sibling of A, so B must not still be on the stack. */
  assert.deepEqual(byText['under c'], ['C']);
});

test('headings are not emitted as body text', () => {
  /* Otherwise the heading is in the output twice: as path and as the
     first line of the chunk beneath it. */
  const blocks = parseBlocks('# Chapter 1\n\nBody.\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'Body.');
});

test('page markers set the page and leave no text behind', () => {
  const blocks = parseBlocks('<!-- page: 1 -->\n\nOne.\n\n<!-- page: 2 -->\n\nTwo.\n');
  assert.ok(blocks.every(b => !b.text.includes('<!-- page')));
  assert.deepEqual(blocks.map(b => b.page), [1, 2]);
});

test('a fenced code block is never split on its blank lines', () => {
  const blocks = parseBlocks('# T\n\n```python\ndef f():\n\n    # a comment\n    pass\n```\n');
  const code = blocks.filter(b => b.text.includes('def f()'));
  assert.equal(code.length, 1);
  /* The #-line inside the fence is a comment, not a heading. */
  assert.ok(code[0].text.includes('# a comment'));
  assert.deepEqual(code[0].path, ['T']);
});

/* ---- splitting ---- */

test('a block that already fits is untouched', () => {
  assert.deepEqual(splitText('Short enough.', 100, count), ['Short enough.']);
});

test('an oversized block is cut on the coarsest boundary that fits', () => {
  const text = Array.from({ length: 20 },
    (_, n) => `Paragraph number ${n} with some words in it.`).join('\n\n');
  const pieces = splitText(text, 40, count);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(p => count(p) <= 40));
  /* Paragraph boundaries sufficed, so no sentence was cut in half. */
  assert.ok(pieces.every(p => p.trim().startsWith('Paragraph')));
});

test('an unbreakable run is cut rather than left oversized', () => {
  /* A chunk over the limit is truncated at embed time, invisibly. */
  const pieces = splitText('x'.repeat(5000), 20, count);
  assert.ok(pieces.length > 1);
});

/* ---- packing ---- */

const headed = n => '# H\n\n' + Array.from({ length: n },
  (_, i) => `Paragraph ${i} with several ordinary words.`).join('\n\n');

const packOpts = extra => Object.assign({
  max_tokens: 60, overlap: 8, heading_context: false,
  count: count, tokenizer: 'estimate', source: 'a.md',
}, extra);

test('no chunk exceeds the budget', () => {
  const chunks = pack(parseBlocks(headed(40)), packOpts());
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.token_count <= 60));
});

test('the overlap carry never pushes a chunk over budget', () => {
  /* The carry is sized alone and the piece was checked alone; together
     they can exceed it, and an oversized chunk is silently truncated at
     embed time rather than rejected. */
  const doc = '# H\n\n' + Array.from({ length: 30 }, () => 'Words '.repeat(12)).join('\n\n');
  const chunks = pack(parseBlocks(doc), packOpts({ max_tokens: 70, overlap: 60 }));
  assert.ok(chunks.every(c => c.token_count <= 70));
});

test('heading context is prepended and counted', () => {
  const chunks = pack(parseBlocks('# A\n\n## B\n\nBody text here.'),
    packOpts({ max_tokens: 512, overlap: 0, heading_context: true }));
  const chunk = chunks[0];
  assert.ok(chunk.text.startsWith('A > B'));
  /* The prefix is embedded too, so it must be inside the count. */
  assert.equal(chunk.token_count, count(chunk.text));
});

test('chunk indexes are contiguous from zero', () => {
  const chunks = pack(parseBlocks(headed(40)), packOpts());
  assert.deepEqual(chunks.map(c => c.chunk_index), chunks.map((_, i) => i));
});

test('tail returns roughly the requested tokens and is a real suffix', () => {
  const text = Array.from({ length: 200 }, (_, n) => `word${n}`).join(' ');
  const got = tail(text, 20, count);
  assert.ok(got);
  assert.ok(count(got) >= 20);
  assert.ok(text.endsWith(got));
});

test('no overlap means no tail', () => {
  assert.equal(tail('some words here', 0, count), '');
});

/* ---- output ---- */

test('jsonl is one record per line and ends with a newline', () => {
  const chunks = pack(parseBlocks(headed(6)), packOpts({ max_tokens: 512 }));
  const jsonl = toJsonl(chunks);
  const lines = jsonl.trimEnd().split('\n');
  assert.equal(lines.length, chunks.length);
  assert.ok(jsonl.endsWith('\n'));
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
});

test('no chunks means an empty file, not a stray newline', () => {
  assert.equal(toJsonl([]), '');
});

test('an overlap at or above max_tokens is refused', () => {
  assert.ok(overlapProblem({ max_tokens: 128, overlap: 128 }));
  assert.ok(overlapProblem({ max_tokens: 128, overlap: 200 }));
  assert.equal(overlapProblem({ max_tokens: 128, overlap: 127 }), null);
});

test('output names become .jsonl and cannot carry a path', () => {
  assert.equal(outputName('report.md'), 'report.jsonl');
  assert.equal(outputName('../../etc/passwd.md'), 'passwd.jsonl');
  assert.equal(outputName(''), 'chunks.jsonl');
});
