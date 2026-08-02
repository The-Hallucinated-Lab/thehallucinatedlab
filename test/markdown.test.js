/* ============================================================
   markdown.test.js — formatMarkdown() renders model output into the
   Assistant transcript. It is the only place on this site where text
   we did not author reaches innerHTML, so it carries the two
   obligations tested here: render correctly, and never emit a live tag.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const { formatMarkdown, escapeHtml } = loadPure('interface.js', ['formatMarkdown', 'escapeHtml']);

/* Any tag other than the fixed set the markdown transforms introduce
   means untrusted text escaped into live markup. */
const ALLOWED_TAGS = /<(?!\/?(?:pre|code|strong|em|br)\b)/i;

test('escapeHtml neutralises every character that can open markup', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  // Ampersand must be escaped first or the other entities get mangled.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('escapeHtml coerces non-strings instead of throwing', () => {
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
  assert.equal(escapeHtml(42), '42');
});

test('fenced code blocks render as <pre><code> with newlines intact', () => {
  const out = formatMarkdown('Try:\n```js\nconst a = 1;\nconst b = 2;\n```\ndone.');
  assert.match(out, /<pre><code>/);
  assert.match(out, /const a = 1;\nconst b = 2;\n/);
  // <pre> is already a block: no stray <br> hugging it.
  assert.doesNotMatch(out, /<br><pre>/);
  assert.doesNotMatch(out, /<\/pre><br>/);
});

/* This is the regression that motivated the fix: newlines were escaped
   into <br> before the fence pattern ran, so ``` never matched and every
   code block rendered as literal backticks. */
test('regression: fenced code is not left as literal backticks', () => {
  const out = formatMarkdown('```python\nprint("hi")\n```');
  assert.doesNotMatch(out, /```/);
  assert.match(out, /<pre><code>/);
});

test('inline formatting renders', () => {
  assert.match(formatMarkdown('use `npm ci` here'), /<code>npm ci<\/code>/);
  assert.match(formatMarkdown('**bold**'), /<strong>bold<\/strong>/);
  assert.match(formatMarkdown('*italic*'), /<em>italic<\/em>/);
  assert.match(formatMarkdown('line one\nline two'), /line one<br>line two/);
});

test('code block content is escaped, not executed', () => {
  const out = formatMarkdown('```\n<script>alert(1)</script>\n```');
  assert.match(out, /&lt;script&gt;/);
  assert.doesNotMatch(out, ALLOWED_TAGS);
});

test('no markdown input can produce a tag outside the allowed set', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '**<svg onload=alert(1)>**',
    '`<img src=x onerror=alert(1)>`',
    '```\n<script>alert(1)</script>\n```',
    '\'"><img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '*<iframe src=data:text/html,<script>alert(1)</script>>*',
    '<style>body{display:none}</style>',
    '<!--<script>alert(1)</script>-->',
    '<BODY ONLOAD=alert(1)>',
    '<img src=x onerror=alert(1)>',
  ];

  for (const payload of payloads) {
    const out = formatMarkdown(payload);
    /* This is the whole test: no `<` may survive except the ones opening
       a tag the markdown transforms are supposed to produce. An escaped
       string may still read 'onerror=alert(1)' as visible text — that is
       inert, because there is no tag for it to be an attribute of. */
    assert.doesNotMatch(out, ALLOWED_TAGS, `payload leaked a tag: ${payload}`);
  }
});

/* The CODEBLOCK sentinel is an internal placeholder. Model output that
   happens to contain that literal string must not be able to smuggle
   markup through the restore step. */
test('the internal code-block placeholder cannot be forged', () => {
  const out = formatMarkdown('CODEBLOCK0 <img src=x onerror=alert(1)>');
  assert.doesNotMatch(out, ALLOWED_TAGS);
});

test('unterminated fences degrade without throwing', () => {
  assert.doesNotThrow(() => formatMarkdown('```js\nconst a = 1;'));
  assert.doesNotThrow(() => formatMarkdown('```'));
  assert.doesNotThrow(() => formatMarkdown('`'));
  assert.doesNotThrow(() => formatMarkdown('**'));
});

test('empty input produces empty output', () => {
  assert.equal(formatMarkdown(''), '');
});
