/* ============================================================
   submission.test.js — the community form is the only place this site
   accepts input and writes it anywhere. These cover the validator and
   the coercion applied to whatever is already sitting in localStorage.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const {
  validateSubmission,
  normalizeStoredPost,
  escapeHtml,
  safeGradient,
  formatDate,
  SUBMISSION_CATEGORIES,
  SUBMISSION_LIMITS,
} = loadPure('articles.js', [
  'validateSubmission', 'normalizeStoredPost', 'escapeHtml',
  'safeGradient', 'formatDate', 'SUBMISSION_CATEGORIES', 'SUBMISSION_LIMITS',
]);

const valid = () => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  title: 'On the Analytical Engine',
  category: 'Research',
  body: 'x'.repeat(SUBMISSION_LIMITS.body.min),
});

test('a well-formed submission passes', () => {
  const r = validateSubmission(valid());
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, {});
});

/* The old handler was `if (!name || !title || !body) return;` — one
   silent bail with no signal to the visitor at all. */
test('regression: an empty submission reports errors instead of failing silently', () => {
  const r = validateSubmission({ name: '', email: '', title: '', category: '', body: '' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.name, 'name error missing');
  assert.ok(r.errors.title, 'title error missing');
  assert.ok(r.errors.body, 'body error missing');
});

test('every problem is reported at once, not one per attempt', () => {
  const r = validateSubmission({ name: 'x', title: 'y', body: 'short', email: 'nope' });
  assert.equal(Object.keys(r.errors).length, 4);
});

test('missing and non-object input does not throw', () => {
  for (const input of [undefined, null, {}, 'string', 42, []]) {
    assert.doesNotThrow(() => validateSubmission(input));
    assert.equal(validateSubmission(input).valid, false);
  }
});

test('length bounds are enforced at both ends', () => {
  const tooLongName = validateSubmission({ ...valid(), name: 'a'.repeat(SUBMISSION_LIMITS.name.max + 1) });
  assert.ok(tooLongName.errors.name);

  const tooLongBody = validateSubmission({ ...valid(), body: 'a'.repeat(SUBMISSION_LIMITS.body.max + 1) });
  assert.ok(tooLongBody.errors.body);

  const atMax = validateSubmission({ ...valid(), body: 'a'.repeat(SUBMISSION_LIMITS.body.max) });
  assert.equal(atMax.valid, true, 'exactly at the limit should pass');
});

test('email is optional but validated when present', () => {
  assert.equal(validateSubmission({ ...valid(), email: '' }).valid, true);
  assert.ok(validateSubmission({ ...valid(), email: 'not-an-email' }).errors.email);
  assert.ok(validateSubmission({ ...valid(), email: 'a@b' }).errors.email, 'needs a TLD');
  assert.equal(validateSubmission({ ...valid(), email: 'a@b.co' }).valid, true);
});

test('values are normalised before storage', () => {
  const r = validateSubmission({ ...valid(), name: '  Ada   Lovelace  ', email: '  ADA@Example.COM ' });
  assert.equal(r.value.name, 'Ada Lovelace', 'whitespace collapsed and trimmed');
  assert.equal(r.value.email, 'ada@example.com', 'email case-folded');
});

test('category falls back to the allowlist rather than storing anything sent', () => {
  assert.equal(validateSubmission({ ...valid(), category: 'Research' }).value.category, 'Research');
  assert.equal(validateSubmission({ ...valid(), category: '<script>' }).value.category, 'General');
  assert.equal(validateSubmission({ ...valid(), category: undefined }).value.category, 'General');
  for (const c of SUBMISSION_CATEGORIES) {
    assert.equal(validateSubmission({ ...valid(), category: c }).value.category, c);
  }
});

test('the stored timestamp keeps its timezone', () => {
  const { date } = validateSubmission(valid()).value;
  assert.match(date, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'expected full ISO 8601, not a bare date');
  assert.ok(!Number.isNaN(new Date(date).getTime()));
});

/* Anything already in localStorage predates this validator, or was put
   there by something else entirely. */
test('stored posts are coerced to a known shape', () => {
  assert.equal(normalizeStoredPost(null), null);
  assert.equal(normalizeStoredPost('a string'), null);
  assert.equal(normalizeStoredPost({}), null, 'no title and no body is not a post');

  const missingName = normalizeStoredPost({ title: 'T', body: 'B' });
  assert.equal(missingName.name, 'Anonymous');

  const badCategory = normalizeStoredPost({ title: 'T', body: 'B', category: 'Injected' });
  assert.equal(badCategory.category, 'General');

  // The old renderer called post.name.charAt(0) directly and threw here.
  assert.doesNotThrow(() => normalizeStoredPost({ title: 'T', body: 'B', name: 12345 }));
});

test('escapeHtml covers attribute-breaking characters', () => {
  assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('safeGradient only lets real gradients into the style attribute', () => {
  const ok = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
  assert.equal(safeGradient(ok), ok);
  assert.equal(safeGradient('radial-gradient(circle, #000, #fff)'), 'radial-gradient(circle, #000, #fff)');

  for (const bad of [
    'red; background-image: url(http://evil/x)',
    'linear-gradient(#000);"><script>alert(1)</script>',
    'url(javascript:alert(1))',
    '', null, undefined,
  ]) {
    assert.equal(safeGradient(bad), 'var(--bg-card)', `let through: ${bad}`);
  }
});

test('formatDate handles junk without rendering "Invalid Date"', () => {
  assert.equal(formatDate('not a date'), '');
  assert.equal(formatDate(undefined), '');
  assert.match(formatDate('2026-07-10T00:00:00.000Z'), /2026/);
});
