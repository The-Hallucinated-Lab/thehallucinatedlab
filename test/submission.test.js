/* ============================================================
   submission.test.js — the note form is the only place this site
   accepts input and writes it anywhere. These cover the validator and
   the coercion applied to whatever is already sitting in localStorage.

   The board files notes by section and tag, so both are part of the
   contract now: a note that loses its tags loses its place on the page,
   and a note written before the board existed has neither.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const {
  validateSubmission,
  normalizeStoredPost,
  noteFromStored,
  escapeHtml,
  safeGradient,
  formatDate,
  resolveSection,
  SECTIONS,
  SUBMISSION_LIMITS,
  LEGACY_CATEGORY_SECTIONS,
} = loadPure('blogs.js', [
  'validateSubmission', 'normalizeStoredPost', 'noteFromStored', 'escapeHtml',
  'safeGradient', 'formatDate', 'resolveSection', 'SECTIONS',
  'SUBMISSION_LIMITS', 'LEGACY_CATEGORY_SECTIONS',
]);

const AI = 'artificial-intelligence';
const SWE = 'software-engineering';

const valid = () => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  title: 'On the Analytical Engine',
  section: SWE,
  tags: 'algorithms, notation',
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
  const r = validateSubmission({ name: '', email: '', title: '', section: '', tags: '', body: '' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.name, 'name error missing');
  assert.ok(r.errors.title, 'title error missing');
  assert.ok(r.errors.body, 'body error missing');
  assert.ok(r.errors.tags, 'tags error missing');
});

test('every problem is reported at once, not one per attempt', () => {
  const r = validateSubmission({ name: 'x', title: 'y', body: 'short', email: 'nope', tags: '' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['body', 'email', 'name', 'tags', 'title']);
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

/* ---- the two fields the board files on ---- */

test('a tag is required, because it is what files the note', () => {
  const missing = validateSubmission({ ...valid(), tags: '' });
  assert.ok(missing.errors.tags);

  /* Typing punctuation is not the same mistake as typing nothing, and
     the message has to be able to tell the visitor which one they made. */
  const punctuation = validateSubmission({ ...valid(), tags: '!!! , ???' });
  assert.ok(punctuation.errors.tags);
  assert.notEqual(punctuation.errors.tags, missing.errors.tags);
});

test('tags are normalised, deduped and bounded', () => {
  const r = validateSubmission({ ...valid(), tags: '  RAG , retrieval augmented , rag, #agents ' });
  assert.deepEqual(r.value.tags, ['rag', 'retrieval-augmented', 'agents']);

  const tooMany = validateSubmission({ ...valid(), tags: 'a1,b2,c3,d4,e5,f6' });
  assert.ok(tooMany.errors.tags, `${SUBMISSION_LIMITS.tags.perNote + 1} tags should be refused`);

  const tooShort = validateSubmission({ ...valid(), tags: 'x' });
  assert.ok(tooShort.errors.tags);

  const tooLong = validateSubmission({ ...valid(), tags: 'a'.repeat(SUBMISSION_LIMITS.tags.maxLength + 1) });
  assert.ok(tooLong.errors.tags);
});

test('section falls back to the allowlist rather than storing anything sent', () => {
  for (const section of SECTIONS) {
    assert.equal(validateSubmission({ ...valid(), section: section.id }).value.section, section.id);
  }
  assert.equal(validateSubmission({ ...valid(), section: '<script>' }).value.section, SECTIONS[0].id);
  assert.equal(validateSubmission({ ...valid(), section: undefined }).value.section, SECTIONS[0].id);
  assert.equal(resolveSection('nonsense'), SECTIONS[0].id);
});

test('the stored timestamp keeps its timezone', () => {
  const { date } = validateSubmission(valid()).value;
  assert.match(date, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'expected full ISO 8601, not a bare date');
  assert.ok(!Number.isNaN(new Date(date).getTime()));
});

test('every note is stored with an id, so it can be deleted again', () => {
  const a = validateSubmission(valid()).value;
  const b = validateSubmission(valid()).value;
  assert.match(a.id, /^note-/);
  assert.notEqual(a.id, b.id, 'two notes must not share an id');
});

/* Anything already in localStorage predates this validator, or was put
   there by something else entirely. */
test('stored posts are coerced to a known shape', () => {
  assert.equal(normalizeStoredPost(null), null);
  assert.equal(normalizeStoredPost('a string'), null);
  assert.equal(normalizeStoredPost({}), null, 'no title and no body is not a post');

  const missingName = normalizeStoredPost({ title: 'T', body: 'B' });
  assert.equal(missingName.name, 'Anonymous');

  const badSection = normalizeStoredPost({ title: 'T', body: 'B', section: 'injected' });
  assert.equal(badSection.section, SECTIONS[0].id);

  const badTags = normalizeStoredPost({ title: 'T', body: 'B', tags: ['ok', { evil: true }, 'a,b'] });
  assert.deepEqual(badTags.tags, ['ok', 'a-b'], 'a non-string tag must not reach the page');

  const tooManyTags = normalizeStoredPost({ title: 'T', body: 'B', tags: 'a1,b2,c3,d4,e5,f6,g7' });
  assert.equal(tooManyTags.tags.length, SUBMISSION_LIMITS.tags.perNote,
    'storage is the one caller that cannot report an error, so it truncates');

  // The old renderer called post.name.charAt(0) directly and threw here.
  assert.doesNotThrow(() => normalizeStoredPost({ title: 'T', body: 'B', name: 12345 }));
});

/* Before the board there was a single `category` per post and no
   section at all. Those notes are still in people's browsers. */
test('a note written before the board keeps its classification', () => {
  const legacy = normalizeStoredPost({ title: 'T', body: 'B', category: 'AI & ML', date: '2026-01-01T00:00:00.000Z' });
  assert.equal(legacy.section, 'artificial-intelligence', 'the category picks the section');
  assert.deepEqual(legacy.tags, ['ai-ml'], 'and survives as a tag');

  const devTools = normalizeStoredPost({ title: 'T', body: 'B', category: 'Dev Tools' });
  assert.equal(devTools.section, SWE);
  assert.deepEqual(devTools.tags, ['dev-tools']);

  /* "General" and "Other" classified nothing to begin with, so they must
     not become a tag — five of them would promote a subsection that
     means nothing. */
  for (const empty of ['General', 'Other']) {
    assert.deepEqual(normalizeStoredPost({ title: 'T', body: 'B', category: empty }).tags, [],
      `${empty} must not become a tag`);
  }

  /* Every legacy category has to land somewhere; a new one appearing in
     that map without a section is how a note goes missing. */
  for (const [category, section] of Object.entries(LEGACY_CATEGORY_SECTIONS)) {
    assert.ok(SECTIONS.some(s => s.id === section), `${category} maps to unknown section ${section}`);
  }

  // An explicit section always wins over the legacy guess.
  const both = normalizeStoredPost({ title: 'T', body: 'B', category: 'Dev Tools', section: AI });
  assert.equal(both.section, AI);
});

test('a legacy note gets a stable id, so deleting it deletes that one', () => {
  const post = { title: 'T', body: 'B', date: '2026-01-01T00:00:00.000Z' };
  const first = normalizeStoredPost(post).id;
  assert.equal(normalizeStoredPost({ ...post }).id, first, 'the same note must fingerprint the same');
  assert.notEqual(normalizeStoredPost({ ...post, title: 'U' }).id, first);
  assert.equal(normalizeStoredPost({ ...post, id: 'note-kept' }).id, 'note-kept', 'a real id is kept');
});

test('a stored note is rendered through the same shape as a published one', () => {
  const note = noteFromStored(normalizeStoredPost({
    title: 'Mine', body: 'Body', name: 'Vis', section: AI, tags: 'rag', date: '2026-01-01T00:00:00.000Z',
  }));
  assert.equal(note.local, true, 'the board has to be able to mark it');
  assert.equal(note.author, 'Vis', 'the author field is what the card renders');
  assert.equal(note.excerpt, 'Body');
  assert.equal(note.articleUrl, null, 'a local note is never a link');
  assert.equal(note.pinned, false);
});

/* ---- escaping, and the two attributes it protects ---- */

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
