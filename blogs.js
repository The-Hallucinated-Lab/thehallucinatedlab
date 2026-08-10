/* ============================================================
   blogs.js — the Blogs board.

   The page is a Keep-style note board rather than a feed. Every note
   declares one section — Artificial Intelligence or Software
   Engineering — and carries its own tags. Nothing else decides where it
   lands, because the filing rule is derived from the tags:

     a tag carried by SUBSECTION_THRESHOLD notes inside one section is
     promoted to a subsection of that section, and every note carrying
     it moves under that heading. Everything else stays loose.

   That is the whole layout algorithm. There is no hand-maintained list
   of subsections to keep in step with the notes: an author enters a tag,
   and the fifth note carrying it creates the subsection.

   The board is pre-rendered as static markup in blogs.html so crawlers
   that do not execute JavaScript still see every published note. This
   file re-renders the same output on load and then owns those
   containers — when NOTES changes below, update blogs.html to match.
   ============================================================ */

/* @pure-start — everything between these markers is free of DOM,
   storage and network access, and is loaded directly by
   test/*.test.js. Keep it that way: reaching for `document` here
   breaks the tests that cover the filing rule, escaping and validation. */

/* ============ SECTIONS ============
   The two sections the board is divided into. Order here is the order
   on the page, and the ids are the anchors blogs.html uses — renaming
   one breaks an inbound link, so treat them as URLs. */
const SECTIONS = [
  {
    id: 'artificial-intelligence',
    label: 'Artificial Intelligence',
    blurb: 'Models, retrieval, orchestration, and what running them locally changes.',
  },
  {
    id: 'software-engineering',
    label: 'Software Engineering',
    blurb: 'The craft around the models — algorithms, tooling, performance, and the browser as a runtime.',
  },
];

/* Five is the rule the board is built around: four notes sharing a tag
   is a coincidence, five is a topic. Lower and a section fragments into
   subsections of two; higher and everything stays loose long past the
   point a reader wants it grouped. */
const SUBSECTION_THRESHOLD = 5;

/* ============ NOTE DATA STORE ============
   Published notes. `tags` are stored already normalised — the shape
   normalizeTag produces — so the filing rule never has to guess, and a
   test fails if one drifts.

   `status` is mandatory and has no default: 'live' is a finished piece
   anyone may read, 'dev' is a raw notebook page that only a dev session
   ever renders. See noteStatus() for why the missing case resolves to
   'dev' rather than the other way round. */
const NOTES = [
  {
    id: 'local-first-ai',
    title: 'The Future of Local-First AI',
    author: 'Pratyush',
    date: '2026-07-10',
    section: 'artificial-intelligence',
    status: 'live',
    tags: ['local-first', 'privacy', 'inference'],
    excerpt: 'Why running AI models entirely on your machine isn\'t just a privacy win — it\'s the future of personal computing. We explore the shift from cloud dependency to local-first intelligence.',
    accent: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    pinned: true,
    articleUrl: 'blogs/sample-blog.html',
  },
  {
    id: 'raw-tokenisation-questions',
    title: 'Raw: tokenisation, the questions',
    author: 'Pratyush',
    date: '2026-08-10',
    section: 'artificial-intelligence',
    status: 'dev',
    tags: ['tokenisation', 'open-questions', 'bpe', 'vocabulary'],
    excerpt: 'Notebook page, transcribed as written: what "best tokeniser" could mean across English and Hindi, what the tokeniser throws away, per-session vocabularies, and whether any of it is differentiable. Overview and reading list attached.',
    articleUrl: 'blogs/dev-tokenisation-questions.html',
  },
  {
    id: 'raw-llm-systems-questions',
    title: 'Raw: eight questions about LLM systems',
    author: 'Pratyush',
    date: '2026-08-10',
    section: 'artificial-intelligence',
    status: 'dev',
    tags: ['open-questions', 'compression', 'alignment', 'local-deployment'],
    excerpt: 'Whether a model is the only route to AI, why GPT-2 wrote worse Python than anything else, YAML against JSON in prompts, and what compression does to alignment. Overview and reading list attached.',
    articleUrl: 'blogs/dev-llm-systems-questions.html',
  },
];

/* ============ TEXT HELPERS ============ */

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* Escapes for both text and attribute contexts. This used to round-trip
   through document.createElement, which meant a DOM allocation per card
   per render and made it impossible to unit test. */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

/* Only ever fed the authored accent values; this keeps anything that is
   not a plain CSS gradient out of the style attribute. */
function safeGradient(value) {
  return /^(linear|radial)-gradient\([^;"<>]*\)$/.test(value || '') ? value : 'var(--bg-card)';
}

function collapseWhitespace(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/* ============ TAGS ============
   A tag is the unit the board files on, so it has exactly one canonical
   form and everything — authored notes, visitor input, whatever is
   already in localStorage — is put through it. Two notes that mean the
   same tag but spell it differently would otherwise never add up to the
   five that promote it. */
const TAG_LIMITS = { perNote: 5, minLength: 2, maxLength: 24 };

/* Tags are rendered as headings once they are promoted, so they get
   title-cased for display. These are the ones where that reads wrong. */
const TAG_ACRONYMS = new Set([
  'ai', 'ml', 'llm', 'llms', 'slm', 'rag', 'api', 'cli', 'gpu', 'cpu',
  'ui', 'ux', 'css', 'html', 'js', 'sql', 'nlp', 'seo', 'csp', 'io', 'oss',
]);

function normalizeTag(raw) {
  return String(raw == null ? '' : raw)
    .toLowerCase()
    /* Anything outside the allowed set becomes a separator rather than
       being dropped, so "AI & ML" is two words and not "aiml". */
    .replace(/[^a-z0-9+.\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/* Splits the raw tag field without normalising, so the validator can
   tell "you typed nothing" from "you typed something that normalised
   away". `#` separates too: "#rag #agents" is what people actually
   type. */
function splitTagInput(raw) {
  if (Array.isArray(raw)) {
    /* An array only ever arrives from localStorage or from NOTES, so its
       entries are already one-tag-each. Anything that is not text is
       dropped rather than coerced — String({}) would file a note under
       "object-object". */
    return raw
      .filter(v => typeof v === 'string' || typeof v === 'number')
      .map(v => String(v))
      .filter(v => v.trim() !== '');
  }
  return String(raw == null ? '' : raw)
    .split(/[,\n#]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/* `limit` truncates rather than rejecting, for the one caller that
   cannot report an error: whatever is already in localStorage. The
   validator passes no limit and complains instead. */
function parseTags(raw, limit) {
  const out = [];
  for (const entry of splitTagInput(raw)) {
    const tag = normalizeTag(entry);
    if (tag && !out.includes(tag)) out.push(tag);
    if (limit && out.length >= limit) break;
  }
  return out;
}

function tagLabel(tag) {
  return String(tag == null ? '' : tag)
    .split('-')
    .filter(Boolean)
    .map(word => (TAG_ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/* ============ SECTIONS ============ */
function resolveSection(value) {
  const match = SECTIONS.find(s => s.id === value);
  return match ? match.id : SECTIONS[0].id;
}

function sectionLabel(id) {
  const match = SECTIONS.find(s => s.id === id);
  return match ? match.label : '';
}

function notesInSection(notes, sectionId) {
  return (Array.isArray(notes) ? notes : []).filter(n => n && n.section === sectionId);
}

/* ============ THE FILING RULE ============ */

/* Pinned first, then newest, then title — so two notes written on the
   same day do not swap places between renders. */
function sortNotes(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (diff) return Number.isNaN(diff) ? 0 : diff;
    return String(a.title).localeCompare(String(b.title));
  });
}

/* How many notes carry each tag. A tag repeated on one note still
   counts once: the threshold is five notes, not five mentions. */
function countTags(notes) {
  const counts = new Map();
  for (const note of Array.isArray(notes) ? notes : []) {
    if (!note) continue;
    for (const tag of new Set(parseTags(note.tags))) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

/* Tags at or over the threshold, strongest first. The alphabetical
   tie-break is load-bearing: without it two tags on the same count
   could swap on a re-render and the subsections would reshuffle under
   the reader. */
function promotedTags(notes, threshold) {
  const limit = Number.isFinite(threshold) ? threshold : SUBSECTION_THRESHOLD;
  return [...countTags(notes).entries()]
    .filter(([, count]) => count >= limit)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/* Splits one section's notes into subsections plus whatever is left
   loose.

   A note carrying two promoted tags goes to the stronger one only,
   rather than being rendered twice: two identical cards under two
   headings reads as a duplicate, not as a cross-reference. The
   consequence is that a promoted tag can end up with every one of its
   notes claimed by a stronger tag — that subsection is dropped rather
   than rendered empty. */
function organiseSection(notes, threshold) {
  const list = (Array.isArray(notes) ? notes : []).filter(Boolean);
  const promoted = promotedTags(list, threshold);
  const buckets = new Map(promoted.map(tag => [tag, []]));
  const loose = [];

  for (const note of list) {
    const own = new Set(parseTags(note.tags));
    const home = promoted.find(tag => own.has(tag));
    if (home) buckets.get(home).push(note);
    else loose.push(note);
  }

  return {
    subsections: promoted
      .map(tag => ({ tag, label: tagLabel(tag), notes: sortNotes(buckets.get(tag)) }))
      .filter(group => group.notes.length > 0),
    loose: sortNotes(loose),
  };
}

/* What the section header shows: every tag in use with its count and
   how far off promotion it is. This is the only place the rule is
   visible before it fires, which is why it exists — otherwise a
   subsection appearing on the fifth note looks like a glitch. */
function tagLedger(notes, threshold) {
  const limit = Number.isFinite(threshold) ? threshold : SUBSECTION_THRESHOLD;
  return [...countTags(notes).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({
      tag,
      label: tagLabel(tag),
      count,
      needed: Math.max(0, limit - count),
      promoted: count >= limit,
    }));
}

/* Search covers everything visible on a card plus the section name, so
   typing "software" or a tag both work. */
function matchesQuery(note, query) {
  const q = collapseWhitespace(query).toLowerCase();
  if (!q) return true;
  if (!note) return false;
  const tags = parseTags(note.tags);
  const haystack = [
    note.title, note.excerpt, note.author,
    sectionLabel(note.section),
    ...tags,
    ...tags.map(tagLabel),
  ].map(v => String(v == null ? '' : v).toLowerCase());
  return haystack.some(v => v.includes(q));
}

function hasTag(note, tag) {
  if (!tag || tag === 'all') return true;
  return parseTags(note && note.tags).includes(tag);
}

/* ============ NOTE APPEARANCE ============
   Keep gives a note a colour; here the colour comes from the note's
   first tag, so a topic looks like itself across the board. Deterministic
   on purpose — a random accent per render makes the same note look like
   a different one after a filter. */
const NOTE_ACCENTS = [
  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  'linear-gradient(135deg, #2a1a0e 0%, #3d2a12 50%, #5a3d18 100%)',
  'linear-gradient(135deg, #0e2a1e 0%, #123d2c 50%, #185a3f 100%)',
  'linear-gradient(135deg, #2a0e1e 0%, #3d1230 50%, #5a1845 100%)',
  'linear-gradient(135deg, #1e1e0e 0%, #2c2c12 50%, #3f3f18 100%)',
  'linear-gradient(135deg, #0e1e2a 0%, #122c3d 50%, #18405a 100%)',
];

function fingerprint(value) {
  let hash = 5381;
  const str = String(value == null ? '' : value);
  for (let i = 0; i < str.length; i++) hash = ((hash * 33) ^ str.charCodeAt(i)) >>> 0;
  return hash;
}

function accentFor(note) {
  if (note && note.accent) return note.accent;
  const seed = (note && parseTags(note.tags)[0]) || (note && note.id) || '';
  return NOTE_ACCENTS[fingerprint(seed) % NOTE_ACCENTS.length];
}

/* A note without a URL is written but not yet published — render it as
   a dead card rather than a link that goes nowhere. */
function isReadable(note) {
  return Boolean(note && note.articleUrl) && note.articleUrl !== '#';
}

/* ============ LIVE NOTES AND RAW NOTES ============
   Two kinds of note, not two polish levels of one kind. A live note is
   finished writing. A raw note is the notebook page it came from — the
   questions as they were actually asked, plus an overview pointing at
   what to read next. Raw notes are for the author, so they sit behind
   dev mode (script.js) and their pages are noindex.

   Two independent gates, the pair the dev-only pages already use: the
   card carries data-status="dev" so CSS hides it, and the board never
   builds a raw card unless the session is already in dev mode.

   Status is required, not defaulted, and the unrecognised case resolves
   to 'dev'. The mistake that matters is a raw note whose status was
   never typed publishing itself. A test rejects it outright. */
function noteStatus(note) {
  return note && note.status === 'live' ? 'live' : 'dev';
}

function isRawNote(note) {
  return noteStatus(note) === 'dev';
}

/* A note written in this browser is the visitor's own, not the lab's
   raw work, so dev mode never filters it. */
function noteVisible(note, mode) {
  if (note && note.local) return true;
  return !isRawNote(note) || mode === 'dev';
}

function visibleNotes(notes, mode) {
  return (Array.isArray(notes) ? notes : []).filter(note => noteVisible(note, mode));
}

/* True when a live visitor may see nothing in the group, which is when
   its heading and count have to be hidden too — otherwise they read
   "1 note" over an empty stack. */
function isRawGroup(notes) {
  const list = Array.isArray(notes) ? notes : [];
  return list.length > 0 && list.every(isRawNote);
}

/* ============ SUBMISSION VALIDATION ============
   The note form is the only place anything on this site accepts input
   and writes it anywhere. Bounds are declared next to the schema rather
   than scattered through the handler, every field is checked so the
   visitor sees all their mistakes at once instead of one per attempt,
   and values are normalised before they are stored.

   Tags are required. The board files on them, so a note without one has
   nowhere to go but the loose pile — and a form that lets you skip the
   field is a form that fills that pile. */
const SUBMISSION_LIMITS = {
  name: { min: 2, max: 80 },
  title: { min: 3, max: 120 },
  body: { min: 20, max: 10000 },
  email: { max: 254 },
  tags: TAG_LIMITS,
};

/* Deliberately permissive. This address is never sent anywhere and
   never used to authenticate anything, so the only job here is to catch
   an obvious typo, not to adjudicate RFC 5322. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function tagErrorFor(entered, tags) {
  if (tags.length === 0) {
    return entered === 0
      ? 'Add at least one tag — tags are what file the note.'
      : 'A tag needs a letter or a number in it.';
  }
  if (entered > TAG_LIMITS.perNote) return `Keep it to ${TAG_LIMITS.perNote} tags.`;
  if (tags.some(t => t.length < TAG_LIMITS.minLength)) {
    return `Each tag needs at least ${TAG_LIMITS.minLength} characters.`;
  }
  if (tags.some(t => t.length > TAG_LIMITS.maxLength)) {
    return `Keep each tag under ${TAG_LIMITS.maxLength} characters.`;
  }
  return null;
}

function newNoteId() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateSubmission(raw) {
  const errors = {};
  const input = raw || {};

  const name = collapseWhitespace(input.name);
  const title = collapseWhitespace(input.title);
  const body = String(input.body == null ? '' : input.body).trim();
  const email = String(input.email == null ? '' : input.email).trim().toLowerCase();
  const tags = parseTags(input.tags);

  if (!name) errors.name = 'Please add your name.';
  else if (name.length < SUBMISSION_LIMITS.name.min) errors.name = 'That name looks too short.';
  else if (name.length > SUBMISSION_LIMITS.name.max) errors.name = `Keep your name under ${SUBMISSION_LIMITS.name.max} characters.`;

  if (!title) errors.title = 'Please add a title.';
  else if (title.length < SUBMISSION_LIMITS.title.min) errors.title = 'That title looks too short.';
  else if (title.length > SUBMISSION_LIMITS.title.max) errors.title = `Keep the title under ${SUBMISSION_LIMITS.title.max} characters.`;

  if (!body) errors.body = 'Please write something before submitting.';
  else if (body.length < SUBMISSION_LIMITS.body.min) errors.body = `Write at least ${SUBMISSION_LIMITS.body.min} characters.`;
  else if (body.length > SUBMISSION_LIMITS.body.max) errors.body = `That is over the ${SUBMISSION_LIMITS.body.max.toLocaleString('en-US')} character limit.`;

  // Optional, but if it is filled in it should be usable.
  if (email) {
    if (email.length > SUBMISSION_LIMITS.email.max) errors.email = 'That email address is too long.';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'That does not look like an email address.';
  }

  const tagError = tagErrorFor(splitTagInput(input.tags).length, tags);
  if (tagError) errors.tags = tagError;

  /* The <select> only offers the two sections, but the value arrives as
     a string and nothing stops it being anything else. Fall back rather
     than reject — a bad section is not the visitor's mistake to fix. */
  const section = resolveSection(input.section);

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      id: newNoteId(),
      name, email, title, section, tags, body,
      // Full ISO 8601, rather than a bare date with the timezone
      // silently discarded.
      date: new Date().toISOString(),
    },
  };
}

/* ============ STORED NOTES ============
   Anything already in localStorage is untrusted: the visitor, another
   script, or an older version of this page could have written it.
   Coerce to a known shape on the way out rather than trusting the
   fields. */

/* Notes written before the board existed carry a single `category` and
   no section at all. Rather than dropping them into the first section
   and losing the only classification they had, the category picks the
   section and survives as the note's first tag. */
const LEGACY_CATEGORY_SECTIONS = {
  'AI & ML': 'artificial-intelligence',
  'Research': 'artificial-intelligence',
  'Open Source': 'software-engineering',
  'Privacy & Security': 'software-engineering',
  'Dev Tools': 'software-engineering',
  'General': 'software-engineering',
  'Other': 'software-engineering',
};

/* General and Other said nothing to begin with, so they do not become
   tags — a note tagged "general" is filed no better than an untagged
   one, and five of them would promote a subsection that means nothing. */
const LEGACY_CATEGORY_UNTAGGED = new Set(['General', 'Other']);

function normalizeStoredPost(post) {
  if (!post || typeof post !== 'object') return null;

  const name = collapseWhitespace(post.name) || 'Anonymous';
  const title = collapseWhitespace(post.title);
  const body = String(post.body == null ? '' : post.body);
  if (!title && !body) return null;

  const category = collapseWhitespace(post.category);
  const legacySection = LEGACY_CATEGORY_SECTIONS[category];
  const legacyTag = legacySection && !LEGACY_CATEGORY_UNTAGGED.has(category) ? [category] : [];

  const tags = parseTags(post.tags, TAG_LIMITS.perNote);

  return {
    id: typeof post.id === 'string' && post.id ? post.id : `note-legacy-${fingerprint(`${post.date}|${title}|${body}`).toString(36)}`,
    name,
    title,
    body,
    section: post.section ? resolveSection(post.section) : resolveSection(legacySection),
    tags: tags.length ? tags : parseTags(legacyTag, TAG_LIMITS.perNote),
    date: post.date,
  };
}

/* Stored notes and published notes are rendered by the same code, so
   they are given the same shape here rather than at every use site. */
function noteFromStored(post) {
  return {
    id: post.id,
    title: post.title || 'Untitled note',
    author: post.name,
    date: post.date,
    section: post.section,
    tags: post.tags,
    excerpt: post.body,
    accent: null,
    pinned: false,
    articleUrl: null,
    /* Stated as well as guarded at the render site: every note the board
       handles should be able to answer what it is on its own. */
    status: 'live',
    local: true,
  };
}

/* @pure-end */

/* ============ NOTE STORAGE ============
   localStorage is synchronous and blocks the main thread, so this store
   is deliberately bounded: oldest entries are evicted past
   MAX_LOCAL_NOTES rather than letting the array grow for as long as
   someone keeps writing. Reads always return an array, whatever is
   actually sitting in storage. */
const NOTES_KEY = 'thl_community_posts';
const MAX_LOCAL_NOTES = 50;

function readStoredNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredPost).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function writeStoredNotes(notes) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes.slice(-MAX_LOCAL_NOTES)));
    return true;
  } catch (err) {
    /* Storage full, or blocked entirely by the browser's settings. The
       board still shows what is in memory for this session, so say so
       rather than pretending the write happened. */
    return false;
  }
}

function addStoredNote(note) {
  return writeStoredNotes([...readStoredNotes(), note]);
}

function removeStoredNote(id) {
  return writeStoredNotes(readStoredNotes().filter(n => n.id !== id));
}

/* The mode script.js resolved onto <html>. Read, never recomputed: one
   place decides, and both scripts are deferred in document order so the
   attribute is set before anything here runs. Anything missing or
   unreadable is 'live' — every ambiguous answer has to land on the
   public view. */
function currentMode() {
  try {
    return document.documentElement.getAttribute('data-mode') === 'dev' ? 'dev' : 'live';
  } catch (err) {
    return 'live';
  }
}

/* Everything on the board: what the lab published, plus whatever this
   browser has written locally, minus the raw notes when this is not a
   dev session. */
function allNotes() {
  return visibleNotes([...NOTES, ...readStoredNotes().map(noteFromStored)], currentMode());
}

/* ============ BOARD STATE ============
   The query and the tag filter narrow what renders. They deliberately
   do not affect the filing rule: subsections are a property of the
   archive, not of the search box, so filtering to one tag must not
   reorganise the board under the reader. */
const boardState = { query: '', tag: 'all' };

/* ============ RENDER: A NOTE ============ */
/* The chip row, split out so the card builder stays under the complexity
   ceiling the lint config sets. Order is deliberate: what the note *is*
   comes before what has been done to it. */
function noteChipsHtml(note, readable, raw) {
  const chips = [];
  if (raw) {
    chips.push('<span class="note-chip note-chip-raw">Raw · dev only</span>');
  }
  if (note.pinned) {
    chips.push(`<span class="note-chip note-chip-pinned"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>Pinned</span>`);
  }
  if (note.local) {
    chips.push('<span class="note-chip note-chip-local">Your note · this browser only</span>');
  } else if (!readable) {
    chips.push('<span class="note-chip note-chip-draft">Draft</span>');
  }
  return chips;
}

function noteCardHtml(note) {
  const readable = isReadable(note);
  const tag = readable ? 'a' : 'div';
  const href = readable ? ` href="${escapeAttr(note.articleUrl)}"` : '';
  const classes = ['note-card', 'fade-in'];
  /* A local note is not a link either, but it is finished work — only an
     unpublished draft is dimmed. */
  if (!readable && !note.local) classes.push('note-card-locked');
  if (note.local) classes.push('note-card-local');

  const raw = isRawNote(note) && !note.local;
  if (raw) classes.push('note-card-raw');
  /* The second gate. allNotes() has already dropped this card in a live
     session; the attribute is what stops it being seen if that filter
     is ever bypassed — a stale render, a copied snippet, a future entry
     point that forgets. */
  const status = raw ? ' data-status="dev"' : '';

  const chips = noteChipsHtml(note, readable, raw);

  const tags = parseTags(note.tags);
  const tagList = tags.length
    ? `<ul class="note-tags">${tags.map(t => `<li class="note-tag">#${escapeHtml(t)}</li>`).join('')}</ul>`
    : '<p class="note-untagged">No tags — this note stays loose.</p>';

  const excerpt = String(note.excerpt == null ? '' : note.excerpt);
  const shown = excerpt.length > 320 ? `${excerpt.slice(0, 320)}…` : excerpt;

  return `
    <${tag}${href}${status} class="${classes.join(' ')}" id="note-${escapeAttr(note.id)}" style="--note-accent: ${safeGradient(accentFor(note))};">
      ${chips.length ? `<div class="note-card-chips">${chips.join('')}</div>` : ''}
      ${note.local ? `<button type="button" class="note-delete" data-note-id="${escapeAttr(note.id)}" aria-label="Delete the note ${escapeAttr(note.title)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg><span class="note-delete-text">Delete</span></button>` : ''}
      <h4 class="note-card-title">${escapeHtml(note.title)}</h4>
      <p class="note-card-text">${escapeHtml(shown)}</p>
      ${tagList}
      <div class="note-card-foot">
        <span class="note-author">${escapeHtml(note.author)}</span>
        <span class="note-dot" aria-hidden="true">·</span>
        <span>${readable || note.local ? formatDate(note.date) : 'Not published yet'}</span>
        ${readable ? '<span class="note-open" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></span>' : ''}
      </div>
    </${tag}>`;
}

/* ============ RENDER: ONE GROUP ============ */
function noteGroupHtml(sectionId, group) {
  const headingId = `group-${sectionId}-${group.isLoose ? 'loose' : group.tag}`;
  const count = `${group.notes.length} note${group.notes.length === 1 ? '' : 's'}`;

  /* A group made only of raw notes takes the marker too. Without it a
     live reader gets a heading and a "1 note" count over a stack with
     nothing in it. */
  const status = isRawGroup(group.notes) ? ' data-status="dev"' : '';

  return `
    <section class="note-group${group.isLoose ? ' note-group-loose' : ''}"${status} aria-labelledby="${escapeAttr(headingId)}">
      <div class="note-group-head">
        <h3 class="note-group-title" id="${escapeAttr(headingId)}">${group.isLoose ? '' : '<span class="note-group-hash" aria-hidden="true">#</span>'}${escapeHtml(group.label)}</h3>
        <span class="note-group-count">${count}</span>
      </div>
      <div class="note-stack">${group.notes.map(noteCardHtml).join('')}</div>
    </section>`;
}

/* ============ RENDER: ONE SECTION ============ */
function renderSection(section, notes) {
  const groupsEl = document.getElementById(`groups-${section.id}`);
  const ledgerEl = document.getElementById(`ledger-${section.id}`);
  const emptyEl = document.getElementById(`empty-${section.id}`);
  if (!groupsEl || !emptyEl) return;

  const mine = notesInSection(notes, section.id);
  const organised = organiseSection(mine, SUBSECTION_THRESHOLD);

  if (ledgerEl) {
    const ledger = tagLedger(mine, SUBSECTION_THRESHOLD);
    ledgerEl.innerHTML = ledger.length
      ? ledger.map(entry => `
        <li class="ledger-tag${entry.promoted ? ' is-promoted' : ''}">
          <span class="ledger-tag-name">#${escapeHtml(entry.tag)}</span>
          <span class="ledger-tag-count">${entry.promoted ? `${entry.count} · subsection` : `${entry.count}/${SUBSECTION_THRESHOLD}`}</span>
        </li>`).join('')
      : '<li class="ledger-tag ledger-tag-none">No tags in this section yet.</li>';
  }

  /* The filter is applied to the groups the rule already produced, so a
     search never moves a note out of its subsection — it only hides the
     ones that do not match. */
  const visible = group => ({
    ...group,
    notes: group.notes.filter(n => hasTag(n, boardState.tag) && matchesQuery(n, boardState.query)),
  });

  const groups = [
    ...organised.subsections.map(group => visible({ ...group, isLoose: false })),
    /* The loose pile is named for what it is. With no subsections yet
       there is nothing for it to be loose from, so it is just the
       section's notes. */
    visible({
      tag: 'loose',
      isLoose: true,
      label: organised.subsections.length ? 'Unfiled' : 'All notes',
      notes: organised.loose,
    }),
  ].filter(group => group.notes.length > 0);

  if (groups.length === 0) {
    groupsEl.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.textContent = mine.length === 0
      ? `Nothing filed under ${section.label} yet. Write the first note below — the tag you give it is what files it.`
      : `No note in ${section.label} matches that. Clear the search or pick another tag.`;
    return;
  }

  emptyEl.hidden = true;
  setContainerHtml(groupsEl, groups.map(group => noteGroupHtml(section.id, group)).join(''));
  observeNewFadeIns(groupsEl);
}

/* ============ RENDER: TAG FILTER ============ */
function renderTagFilters(notes) {
  const container = document.getElementById('board-filters');
  if (!container) return;

  /* Board-wide, and capped: a chip row that wraps to four lines is a
     worse way to find a tag than the search box next to it. */
  const top = tagLedger(notes, SUBSECTION_THRESHOLD).slice(0, 12);
  if (!top.some(entry => entry.tag === boardState.tag)) boardState.tag = 'all';

  container.innerHTML = [
    `<button class="filter-btn${boardState.tag === 'all' ? ' active' : ''}" data-tag="all" type="button">All notes</button>`,
    ...top.map(entry => `<button class="filter-btn${boardState.tag === entry.tag ? ' active' : ''}" data-tag="${escapeAttr(entry.tag)}" type="button">#${escapeHtml(entry.tag)}</button>`),
  ].join('');
}

/* ============ RENDER: THE BOARD ============ */
function renderBoard() {
  const notes = allNotes();
  renderTagFilters(notes);
  SECTIONS.forEach(section => renderSection(section, notes));
}

/* ============ FORM HANDLING ============ */
/* Attaches (or clears) a message under one field, and marks the input
   invalid for screen readers as well as sighted visitors. */
function setFieldError(fieldId, message) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  const errorId = `${fieldId}-error`;
  let el = document.getElementById(errorId);

  if (!message) {
    if (el) el.remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    return;
  }

  if (!el) {
    el = document.createElement('p');
    el.id = errorId;
    el.className = 'form-error';
    input.insertAdjacentElement('afterend', el);
  }
  el.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', errorId);
}

function showToast(message) {
  const toast = document.getElementById('board-toast');
  if (!toast) return;
  const label = toast.querySelector('.board-toast-text');
  if (label) label.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

const FORM_FIELDS = ['note-name', 'note-email', 'note-title', 'note-tags', 'note-body'];

function initNoteForm() {
  const form = document.getElementById('note-form');
  if (!form) return;

  let submitting = false;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    /* The handler is synchronous, but the scroll and toast below run on
       timers — without this a double-click lands two identical notes. */
    if (submitting) return;

    const read = id => {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };

    const result = validateSubmission({
      name: read('note-name'),
      email: read('note-email'),
      title: read('note-title'),
      section: read('note-section'),
      tags: read('note-tags'),
      body: read('note-body'),
    });

    // Clear the last attempt's messages, then show every current
    // problem at once rather than making the visitor discover them one
    // at a time.
    FORM_FIELDS.forEach(id => setFieldError(id, null));

    if (!result.valid) {
      Object.entries(result.errors).forEach(([field, message]) => {
        setFieldError(`note-${field}`, message);
      });
      const firstBad = document.getElementById(`note-${Object.keys(result.errors)[0]}`);
      if (firstBad) {
        firstBad.focus();
        firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    submitting = true;
    const stored = addStoredNote(result.value);
    form.reset();

    /* Filing the note and then hiding it behind a stale filter reads as
       the submit having failed. */
    boardState.query = '';
    boardState.tag = 'all';
    const search = document.getElementById('board-search');
    if (search) search.value = '';
    renderBoard();

    const target = SECTIONS.find(s => s.id === result.value.section);
    showToast(stored
      ? `Filed under ${target ? target.label : 'the board'} — tagged #${result.value.tags.join(' #')}.`
      : 'This browser is blocking local storage, so the note is on the board for this session only.');

    const landing = document.getElementById(`blogs-${result.value.section}`);
    if (landing) {
      setTimeout(() => landing.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    }

    setTimeout(() => { submitting = false; }, 1000);
  });

  // Clear a field's error as soon as the visitor starts fixing it.
  FORM_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => setFieldError(id, null));
  });
}

/* ============ DELETING A LOCAL NOTE ============
   Two clicks, not one. The notes live only in this browser, so a
   deletion cannot be undone from anywhere else — and a confirm() dialog
   is not available here, because the CSP-era lint forbids it. The
   button therefore arms itself first and disarms on a timer, so a
   mis-click costs nothing. */
const DELETE_ARM_MS = 4000;
let armedDelete = null;
let armedTimer = null;

function disarmDelete() {
  clearTimeout(armedTimer);
  armedTimer = null;
  if (!armedDelete) return;
  const btn = document.querySelector(`.note-delete[data-note-id="${CSS.escape(armedDelete)}"]`);
  if (btn) {
    btn.classList.remove('is-armed');
    const label = btn.querySelector('.note-delete-text');
    if (label) label.textContent = 'Delete';
  }
  armedDelete = null;
}

function initNoteDeletion() {
  SECTIONS.forEach(section => {
    const container = document.getElementById(`groups-${section.id}`);
    if (!container) return;

    /* Delegated, and bound once: the containers are re-rendered on
       every submit, filter and delete, so a listener per button would
       be a listener per render. */
    container.addEventListener('click', (event) => {
      const btn = event.target.closest('.note-delete');
      if (!btn) return;
      event.preventDefault();

      const id = btn.dataset.noteId;
      if (armedDelete !== id) {
        disarmDelete();
        armedDelete = id;
        btn.classList.add('is-armed');
        const label = btn.querySelector('.note-delete-text');
        if (label) label.textContent = 'Delete for good?';
        armedTimer = setTimeout(disarmDelete, DELETE_ARM_MS);
        return;
      }

      disarmDelete();
      removeStoredNote(id);
      renderBoard();
      showToast('Note deleted from this browser.');
    });
  });
}

/* ============ SEARCH & FILTER ============ */
function initBoardControls() {
  const search = document.getElementById('board-search');
  const filters = document.getElementById('board-filters');

  if (search) {
    let debounceTimer;
    search.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        boardState.query = search.value;
        renderBoard();
      }, 250);
    });
  }

  if (filters) {
    filters.addEventListener('click', (event) => {
      const btn = event.target.closest('.filter-btn');
      if (!btn) return;
      boardState.tag = btn.dataset.tag || 'all';
      renderBoard();
    });
  }
}

/* ============ OBSERVE NEW FADE-INS ============
   One observer for the whole page, not one per render. The board
   re-renders on every filter click and every debounced keystroke; an
   earlier version built a fresh IntersectionObserver each time and
   never disconnected it, so each render left behind an observer still
   holding strong references to the card elements innerHTML had just
   thrown away — a detached DOM tree per search keystroke.

   Targets are unobserved as soon as they reveal, and the cards a
   container is about to discard are unobserved before it re-renders. */
const fadeObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    obs.unobserve(entry.target);
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

/* Replace a container's contents without stranding the old cards
   inside the observer. */
function setContainerHtml(container, html) {
  container.querySelectorAll('.fade-in').forEach(el => fadeObserver.unobserve(el));
  container.innerHTML = html;
}

function observeNewFadeIns(container) {
  container.querySelectorAll('.fade-in:not(.visible)').forEach(el => fadeObserver.observe(el));
}

/* ============ INIT ============
   Isolated for the same reason as script.js: a corrupt entry in
   localStorage should not take the rest of the page down with it. The
   static markup in blogs.html already covers every published note, so a
   failure here degrades to the server-rendered board rather than to a
   blank page. */
document.addEventListener('DOMContentLoaded', () => {
  [
    ['board', renderBoard],
    ['controls', initBoardControls],
    ['deletion', initNoteDeletion],
    ['note-form', initNoteForm],
  ].forEach(([name, run]) => {
    try {
      run();
    } catch (err) {
      console.error(`[blogs] ${name} failed:`, err);
    }
  });
});
