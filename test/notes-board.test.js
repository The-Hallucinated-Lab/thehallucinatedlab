/* ============================================================
   notes-board.test.js — the rule the Blogs page is built on.

   The board has no hand-maintained list of subsections. A note declares
   a section and its tags, and a tag carried by SUBSECTION_THRESHOLD
   notes inside one section is promoted to a subsection of it. That means
   the page layout is a pure function of the note data, and this file is
   where that function is pinned down:

     - the threshold fires at exactly five, not four and not six
     - a note carrying two promoted tags is filed once, not twice
     - the order of subsections cannot depend on Map insertion order,
       or the board reshuffles under the reader between renders
     - searching and filtering must not reorganise anything

   Everything here runs against the pure block of blogs.js. No DOM.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const {
  NOTES,
  SECTIONS,
  SUBSECTION_THRESHOLD,
  normalizeTag,
  parseTags,
  tagLabel,
  countTags,
  promotedTags,
  organiseSection,
  tagLedger,
  notesInSection,
  sortNotes,
  matchesQuery,
  hasTag,
  accentFor,
  isReadable,
  safeGradient,
  noteStatus,
  isRawNote,
  noteVisible,
  visibleNotes,
  isRawGroup,
} = loadPure('blogs.js', [
  'NOTES', 'SECTIONS', 'SUBSECTION_THRESHOLD', 'normalizeTag', 'parseTags',
  'tagLabel', 'countTags', 'promotedTags', 'organiseSection', 'tagLedger',
  'notesInSection', 'sortNotes', 'matchesQuery', 'hasTag', 'accentFor',
  'isReadable', 'safeGradient', 'noteStatus', 'isRawNote', 'noteVisible',
  'visibleNotes', 'isRawGroup',
]);

const AI = 'artificial-intelligence';
const SWE = 'software-engineering';

/* n notes in one section, all carrying `tags`. */
function notes(count, tags, extra) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${tags.join('')}${i}`,
    title: `Note ${tags.join('-')} ${i}`,
    author: 'Author',
    date: `2026-0${(i % 9) + 1}-01`,
    section: AI,
    tags,
    excerpt: 'Body text.',
    ...extra,
  }));
}

/* ---- the sections themselves ---- */

test('the board has the two sections the page is built around', () => {
  assert.deepEqual(SECTIONS.map(s => s.id), [AI, SWE]);
  for (const section of SECTIONS) {
    assert.ok(section.label, `${section.id} has no label`);
  }
});

test('notes only ever appear under the section they declare', () => {
  const list = [...notes(2, ['rag']), { id: 'x', section: SWE, tags: ['algorithms'], date: '2026-01-01', title: 'X' }];
  assert.equal(notesInSection(list, AI).length, 2);
  assert.equal(notesInSection(list, SWE).length, 1);
  assert.equal(notesInSection(list, 'nope').length, 0);
  assert.deepEqual(notesInSection(null, AI), [], 'no notes is not an error');
});

/* ---- tag normalisation ----
   Two notes that mean the same tag but spell it differently would never
   add up to the five that promote it, so the canonical form is part of
   the rule rather than a cosmetic detail. */

test('a tag has exactly one canonical form', () => {
  assert.equal(normalizeTag('RAG'), 'rag');
  assert.equal(normalizeTag('  Local First  '), 'local-first');
  assert.equal(normalizeTag('#privacy'), 'privacy');
  assert.equal(normalizeTag('AI & ML'), 'ai-ml', 'a dropped separator would glue words together');
  assert.equal(normalizeTag('node.js'), 'node.js');
  assert.equal(normalizeTag('c++'), 'c++');
  assert.equal(normalizeTag('--dashes--'), 'dashes');
  assert.equal(normalizeTag('  '), '');
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag(undefined), '');
  assert.equal(normalizeTag('<script>alert(1)</script>'), 'script-alert-1-script',
    'markup normalises to a tag, not to markup');
});

test('the tag field is split the way people actually type it', () => {
  assert.deepEqual(parseTags('rag, agents'), ['rag', 'agents']);
  assert.deepEqual(parseTags('#rag #agents'), ['rag', 'agents'], 'hashtags separate too');
  assert.deepEqual(parseTags('rag\nagents'), ['rag', 'agents']);
  assert.deepEqual(parseTags('machine learning'), ['machine-learning'], 'a space inside one tag is not a separator');
  assert.deepEqual(parseTags('rag, RAG, rag'), ['rag'], 'duplicates collapse');
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags(null), []);
  assert.deepEqual(parseTags(['a', 'b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(parseTags('a,b,c,d', 2), ['a', 'b'], 'the limit truncates');
});

test('a promoted tag reads as a heading', () => {
  assert.equal(tagLabel('local-first'), 'Local First');
  assert.equal(tagLabel('rag'), 'RAG', 'an acronym must not render as "Rag"');
  assert.equal(tagLabel('llm-ops'), 'LLM Ops');
  assert.equal(tagLabel('node.js'), 'Node.js');
  assert.equal(tagLabel(''), '');
  assert.equal(tagLabel(null), '');
});

/* ---- counting ---- */

test('a tag is counted once per note, not once per mention', () => {
  const counts = countTags([{ tags: ['rag', 'rag', 'RAG'] }, { tags: ['rag'] }]);
  assert.equal(counts.get('rag'), 2, 'the threshold is five notes, not five mentions');
});

test('counting survives junk in the list', () => {
  assert.equal(countTags(null).size, 0);
  assert.equal(countTags([null, undefined, {}]).size, 0);
  assert.equal(countTags([{ tags: 'rag, agents' }]).get('agents'), 1, 'a string tag field still counts');
});

/* ---- the threshold ---- */

test(`a tag becomes a subsection at exactly ${SUBSECTION_THRESHOLD} notes`, () => {
  assert.equal(SUBSECTION_THRESHOLD, 5, 'the page copy and llms-full.txt both state five');

  const under = organiseSection(notes(SUBSECTION_THRESHOLD - 1, ['rag']), SUBSECTION_THRESHOLD);
  assert.deepEqual(under.subsections, [], 'four notes on a tag is a coincidence');
  assert.equal(under.loose.length, SUBSECTION_THRESHOLD - 1, 'and they stay loose');

  const at = organiseSection(notes(SUBSECTION_THRESHOLD, ['rag']), SUBSECTION_THRESHOLD);
  assert.equal(at.subsections.length, 1, 'the fifth note promotes the tag');
  assert.equal(at.subsections[0].tag, 'rag');
  assert.equal(at.subsections[0].label, 'RAG');
  assert.equal(at.subsections[0].notes.length, SUBSECTION_THRESHOLD);
  assert.deepEqual(at.loose, [], 'nothing is left over');
});

test('only the tag that hit the threshold is promoted', () => {
  const list = [...notes(5, ['rag']), ...notes(2, ['agents'])];
  const organised = organiseSection(list, SUBSECTION_THRESHOLD);
  assert.deepEqual(organised.subsections.map(s => s.tag), ['rag']);
  assert.equal(organised.loose.length, 2, 'the two agents notes are still unfiled');
});

test('the threshold counts notes inside one section, not across the board', () => {
  /* Five notes on one tag, split three/two across the sections, must
     promote nothing: a section is the unit the rule applies to. */
  const list = [...notes(3, ['rag']), ...notes(2, ['rag']).map(n => ({ ...n, section: SWE }))];
  assert.deepEqual(promotedTags(notesInSection(list, AI), SUBSECTION_THRESHOLD), []);
  assert.deepEqual(promotedTags(notesInSection(list, SWE), SUBSECTION_THRESHOLD), []);
  assert.deepEqual(promotedTags(list, SUBSECTION_THRESHOLD), ['rag'],
    'the whole list would promote it, which is exactly why the caller filters first');
});

/* ---- a note with more than one promoted tag ---- */

test('a note carrying two promoted tags is filed once, under the stronger one', () => {
  /* Six notes tagged rag, five of which are also tagged agents. Both
     clear the threshold, but rendering those five twice would read as a
     duplicate rather than a cross-reference. */
  const both = notes(5, ['rag', 'agents']);
  const ragOnly = notes(1, ['rag']);
  const organised = organiseSection([...both, ...ragOnly], SUBSECTION_THRESHOLD);

  const placements = organised.subsections.flatMap(s => s.notes.map(n => n.id));
  assert.equal(placements.length, new Set(placements).size, 'a note appears once');
  assert.equal(placements.length + organised.loose.length, 6, 'and every note appears at all');

  assert.deepEqual(organised.subsections.map(s => s.tag), ['rag'],
    'agents has five notes but they are all claimed by rag, so its subsection is dropped rather than rendered empty');
  assert.equal(organised.subsections[0].notes.length, 6);
});

test('every note ends up somewhere, tagged or not', () => {
  const list = [...notes(5, ['rag']), ...notes(3, ['agents']), ...notes(2, [])];
  const organised = organiseSection(list, SUBSECTION_THRESHOLD);
  const placed = organised.subsections.flatMap(s => s.notes).length + organised.loose.length;
  assert.equal(placed, list.length);
  assert.equal(organised.loose.length, 5, 'untagged notes are loose, not lost');
});

test('organising junk does not throw', () => {
  for (const input of [undefined, null, [], [null], 'string', 42]) {
    assert.doesNotThrow(() => organiseSection(input, SUBSECTION_THRESHOLD));
  }
  assert.deepEqual(organiseSection([null, undefined], SUBSECTION_THRESHOLD).subsections, []);
  assert.equal(organiseSection(notes(5, ['rag'])).subsections.length, 1,
    'the threshold defaults rather than being required at every call site');
});

/* ---- order stability ----
   The board is re-rendered on every keystroke in the search box. If two
   subsections on the same count could swap, the page would reshuffle
   while the reader was looking at it. */

test('subsections are ordered by count, then alphabetically', () => {
  const list = [
    ...notes(7, ['rag']),
    ...notes(5, ['zeta']),
    ...notes(5, ['alpha']),
  ];
  const organised = organiseSection(list, SUBSECTION_THRESHOLD);
  assert.deepEqual(organised.subsections.map(s => s.tag), ['rag', 'alpha', 'zeta']);
});

test('the same notes in a different order produce the same board', () => {
  const list = [...notes(6, ['beta']), ...notes(6, ['alpha']), ...notes(2, ['loose'])];
  const forward = organiseSection(list, SUBSECTION_THRESHOLD);
  const backward = organiseSection([...list].reverse(), SUBSECTION_THRESHOLD);
  assert.deepEqual(
    forward.subsections.map(s => [s.tag, s.notes.map(n => n.id)]),
    backward.subsections.map(s => [s.tag, s.notes.map(n => n.id)]),
  );
});

test('notes sort pinned first, then newest, then by title', () => {
  const sorted = sortNotes([
    { id: 'old', title: 'B', date: '2026-01-01' },
    { id: 'new', title: 'C', date: '2026-06-01' },
    { id: 'pin', title: 'D', date: '2020-01-01', pinned: true },
    { id: 'tie', title: 'A', date: '2026-06-01' },
  ]);
  assert.deepEqual(sorted.map(n => n.id), ['pin', 'tie', 'new', 'old']);
});

test('an unparseable date does not scramble the order', () => {
  assert.doesNotThrow(() => sortNotes([{ title: 'A', date: 'nonsense' }, { title: 'B', date: '2026-01-01' }]));
  assert.equal(sortNotes([]).length, 0);
});

/* ---- the ledger ---- */

test('the ledger says how far each tag is from being promoted', () => {
  const ledger = tagLedger([...notes(5, ['rag']), ...notes(2, ['agents'])], SUBSECTION_THRESHOLD);
  assert.deepEqual(ledger.map(e => e.tag), ['rag', 'agents'], 'strongest first');

  const [rag, agents] = ledger;
  assert.equal(rag.promoted, true);
  assert.equal(rag.needed, 0);
  assert.equal(agents.promoted, false);
  assert.equal(agents.count, 2);
  assert.equal(agents.needed, SUBSECTION_THRESHOLD - 2, 'this is the number the page prints');
  assert.deepEqual(tagLedger([], SUBSECTION_THRESHOLD), []);
});

/* ---- search and filter ----
   These narrow what renders. They must not touch the filing rule: a
   search that reorganises the board loses the reader's place. */

test('search covers everything on a card, plus the section name', () => {
  const [note] = notes(1, ['local-first']);
  assert.equal(matchesQuery(note, ''), true, 'an empty query matches everything');
  assert.equal(matchesQuery(note, '   '), true);
  assert.equal(matchesQuery(note, 'note local-first'), true, 'the title');
  assert.equal(matchesQuery(note, 'AUTHOR'), true, 'case-insensitively');
  assert.equal(matchesQuery(note, 'local-first'), true, 'the raw tag');
  assert.equal(matchesQuery(note, 'Local First'), true, 'and the label it renders as');
  assert.equal(matchesQuery(note, 'artificial'), true, 'the section it is filed under');
  assert.equal(matchesQuery(note, 'quantum'), false);
  assert.equal(matchesQuery(null, 'x'), false);
});

test('the tag filter matches the canonical tag', () => {
  const [note] = notes(1, ['rag']);
  assert.equal(hasTag(note, 'all'), true);
  assert.equal(hasTag(note, ''), true, 'no filter is not a filter');
  assert.equal(hasTag(note, 'rag'), true);
  assert.equal(hasTag(note, 'agents'), false);
  assert.equal(hasTag(null, 'rag'), false);
});

test('filtering to one tag cannot promote it', () => {
  /* The page filters the groups the rule already produced, rather than
     re-running the rule on the filtered list. If it did the latter,
     narrowing to a two-note tag would print it as a subsection. */
  const list = [...notes(2, ['agents']), ...notes(1, ['rag'])];
  const organised = organiseSection(list, SUBSECTION_THRESHOLD);
  const shown = organised.loose.filter(n => hasTag(n, 'agents'));
  assert.deepEqual(organised.subsections, []);
  assert.equal(shown.length, 2, 'the notes still show, they are just still unfiled');
});

/* ---- the published notes ---- */

test('every published note declares a real section and canonical tags', () => {
  for (const note of NOTES) {
    assert.ok(SECTIONS.some(s => s.id === note.section), `${note.id} is filed under "${note.section}"`);
    assert.ok(note.tags.length > 0, `${note.id} has no tags, so it can never be filed`);
    for (const tag of note.tags) {
      assert.equal(tag, normalizeTag(tag), `${note.id} tag "${tag}" is not stored canonically`);
    }
    assert.equal(new Set(note.tags).size, note.tags.length, `${note.id} repeats a tag`);
    assert.ok(note.title && note.author && note.excerpt, `${note.id} is missing card copy`);
    assert.ok(!Number.isNaN(new Date(note.date).getTime()), `${note.id} has an unparseable date`);
  }
});

/* ---- live notes and raw notes ----
   The board carries finished pieces and notebook pages, and the second
   kind is held back by dev mode. Everything below exists because the
   failure is silent in the direction that matters: a raw note that
   leaks looks exactly like a published one to the visitor reading it. */

test('every note declares a status the board can filter on', () => {
  for (const note of NOTES) {
    assert.ok(['live', 'dev'].includes(note.status),
      `${note.id} has status ${JSON.stringify(note.status)}; expected "live" or "dev"`);
  }
});

test('a note with no usable status is treated as raw, never as live', () => {
  /* The opposite of how nav entries resolve (script.js), and deliberately
     so. An unrecognised nav entry renders — the cost is a stray link. An
     unrecognised note would publish — the cost is unfinished work in
     front of a visitor. Each defaults to whichever answer is survivable. */
  assert.equal(noteStatus({}), 'dev', 'a missing status must not read as live');
  assert.equal(noteStatus({ status: 'DEV' }), 'dev');
  assert.equal(noteStatus({ status: 'Live' }), 'dev', 'case must not smuggle a note out of dev mode');
  assert.equal(noteStatus({ status: 'published' }), 'dev', 'an invented status is not live');
  assert.equal(noteStatus(null), 'dev');
  assert.equal(noteStatus({ status: 'live' }), 'live');
  assert.equal(isRawNote({ status: 'live' }), false);
  assert.equal(isRawNote({ status: 'dev' }), true);
});

test('raw notes reach a dev session and no other', () => {
  const live = { id: 'a', status: 'live' };
  const raw = { id: 'b', status: 'dev' };

  assert.equal(noteVisible(live, 'live'), true);
  assert.equal(noteVisible(live, 'dev'), true, 'dev mode adds notes, it never removes them');
  assert.equal(noteVisible(raw, 'live'), false);
  assert.equal(noteVisible(raw, 'dev'), true);

  /* An unrecognised mode is not dev. Same reasoning as normalizeMode. */
  assert.equal(noteVisible(raw, 'DEV'), false);
  assert.equal(noteVisible(raw, undefined), false);

  assert.deepEqual(visibleNotes([live, raw], 'live').map(n => n.id), ['a']);
  assert.deepEqual(visibleNotes([live, raw], 'dev').map(n => n.id), ['a', 'b']);
  assert.deepEqual(visibleNotes(null, 'dev'), []);
});

test("a visitor's own note is never held back by dev mode", () => {
  /* Notes written in the browser have no status of the lab's choosing.
     Filtering them would delete the visitor's work from their own board
     depending on a mode they did not set. */
  assert.equal(noteVisible({ local: true }, 'live'), true);
  assert.equal(noteVisible({ local: true, status: 'dev' }, 'live'), true);
});

test('a group of nothing but raw notes is hidden whole', () => {
  /* Otherwise a live reader gets a heading and a "1 note" count sitting
     over a stack with nothing in it. */
  const live = { status: 'live' };
  const raw = { status: 'dev' };
  assert.equal(isRawGroup([raw, raw]), true);
  assert.equal(isRawGroup([raw, live]), false, 'one live note keeps the heading');
  assert.equal(isRawGroup([]), false, 'an empty group is not a dev group');
});

test('every raw note points at a page that is itself noindex', () => {
  /* The card is one gate; the page is the other. A raw note linking to
     an indexable page would put the whole thing in search results while
     the board still believes it is hidden. */
  for (const note of NOTES) {
    if (!isRawNote(note) || !isReadable(note)) continue;
    const src = fs.readFileSync(path.join(ROOT, note.articleUrl), 'utf8');
    assert.match(src, /<meta name="robots" content="noindex/,
      `${note.id} links to ${note.articleUrl}, which is indexable`);
  }
});

test('every published note either links somewhere real or is marked a draft', () => {
  for (const note of NOTES) {
    if (!isReadable(note)) continue;
    assert.ok(fs.existsSync(path.join(ROOT, note.articleUrl)), `${note.id} links to a missing file`);
  }
});

test('a note without an authored accent still gets a stable one', () => {
  const [note] = notes(1, ['rag']);
  const first = accentFor(note);
  assert.equal(accentFor({ ...note }), first, 'the same note must not change colour on re-render');
  assert.equal(safeGradient(first), first, 'and it has to survive the style-attribute guard');
  assert.notEqual(accentFor(notes(1, ['zzz-other'])[0]), undefined);
  assert.equal(accentFor({ ...note, accent: 'linear-gradient(1deg, #000, #fff)' }), 'linear-gradient(1deg, #000, #fff)');
  assert.equal(safeGradient(accentFor({})), safeGradient(accentFor({})), 'an empty note does not throw');
});

/* ---- the page mirrors the data ----
   blogs.html pre-renders the board so crawlers that do not run
   JavaScript see it. That copy is written by hand, so it drifts
   silently. */

test('the pre-rendered board in blogs.html matches the note data', () => {
  const html = fs.readFileSync(path.join(ROOT, 'blogs.html'), 'utf8');

  for (const section of SECTIONS) {
    assert.ok(html.includes(`id="blogs-${section.id}"`), `blogs.html has no ${section.id} section`);
    assert.ok(html.includes(`id="groups-${section.id}"`), `blogs.html has no container for ${section.id}`);
    assert.ok(html.includes(`id="empty-${section.id}"`), `blogs.html has no empty state for ${section.id}`);
    assert.ok(html.includes(`>${section.label}<`), `blogs.html never names ${section.label}`);
  }

  for (const note of NOTES.filter(n => !isRawNote(n))) {
    assert.ok(html.includes(`id="note-${note.id}"`), `${note.id} is missing from the pre-rendered board`);
    assert.ok(html.includes(note.title.replace(/&/g, '&amp;')), `${note.id}'s title is missing`);
    for (const tag of note.tags) {
      assert.ok(html.includes(`>#${tag}</li>`), `${note.id}'s #${tag} chip is missing`);
    }
  }

  /* The rule is stated to the reader in prose. If the constant moves and
     the copy does not, the page lies about how it works. */
  assert.ok(html.includes(`five notes`) || html.includes(String(SUBSECTION_THRESHOLD)),
    'blogs.html never states the threshold');
});

test('no raw note is pre-rendered into blogs.html', () => {
  /* The pre-render exists for crawlers that do not run JavaScript, which
     is precisely the audience a raw note is not for. A hidden card is
     still in the source: data-status="dev" is display:none, not absence,
     so pre-rendering one would put the notebook into the index of a page
     that is itself indexable. Raw cards are built by blogs.js at load
     time instead, and only when the session is already in dev mode. */
  const html = fs.readFileSync(path.join(ROOT, 'blogs.html'), 'utf8');
  const leaked = NOTES
    .filter(isRawNote)
    .filter(note => html.includes(`id="note-${note.id}"`) || html.includes(note.title))
    .map(note => note.id);

  assert.deepEqual(leaked, [],
    `raw notes in the crawler-visible board:\n  ${leaked.join('\n  ')}`);
});
