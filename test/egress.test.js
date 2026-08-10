/* ============================================================
   egress.test.js — the topic queue on the Blogs page.

   The board renders what has been published. This covers the other end
   of the pipe: topics that are only an intention yet, grouped by stage.

   Two properties are worth pinning down, and neither is visible by eye:

     - a topic can never vanish. An unrecognised stage resolves into the
       first one rather than filtering the topic out, so a typo in the
       data shows up on the page in the wrong column — loud — instead of
       silently removing a topic nobody then notices is missing.
     - the stage order is the declared order, always. Rendering walks
       EGRESS_STAGES rather than the topics, so the columns cannot
       reshuffle when the topic list is reordered, and an empty stage
       still renders.

   Everything here runs against the pure block of blogs.js. No DOM.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const {
  TOPICS,
  EGRESS_STAGES,
  SECTIONS,
  resolveStage,
  topicsInStage,
  organiseEgress,
} = loadPure('blogs.js', [
  'TOPICS', 'EGRESS_STAGES', 'SECTIONS',
  'resolveStage', 'topicsInStage', 'organiseEgress',
]);

test('an unrecognised stage resolves to the first one rather than vanishing', () => {
  assert.equal(resolveStage('drafting'), 'drafting', 'a real stage is honoured');
  assert.equal(resolveStage('queued'), 'queued');
  assert.equal(resolveStage('nonsense'), EGRESS_STAGES[0].id, 'a typo lands in the first stage');
  assert.equal(resolveStage(null), EGRESS_STAGES[0].id);
  assert.equal(resolveStage(undefined), EGRESS_STAGES[0].id);
  assert.equal(resolveStage(''), EGRESS_STAGES[0].id);
  assert.equal(resolveStage('DRAFTING'), EGRESS_STAGES[0].id, 'ids are exact, not case-folded');
});

test('every topic reaches exactly one stage, and none is dropped', () => {
  /* The sum is the assertion. A filter that quietly discarded an
     unrecognised stage would still produce a page that looks right. */
  const grouped = organiseEgress(TOPICS);
  const total = grouped.reduce((n, stage) => n + stage.topics.length, 0);
  assert.equal(total, TOPICS.length, 'a topic was lost or duplicated between stages');

  const seen = grouped.flatMap(stage => stage.topics.map(t => t.id));
  assert.deepEqual([...new Set(seen)].sort(), TOPICS.map(t => t.id).sort());
});

test('a topic with a broken stage still appears', () => {
  const grouped = organiseEgress([{ id: 'x', title: 'X', section: 'artificial-intelligence', stage: 'not-a-stage' }]);
  const total = grouped.reduce((n, stage) => n + stage.topics.length, 0);
  assert.equal(total, 1, 'the topic was filtered out instead of being surfaced');
  assert.equal(grouped[0].topics[0].id, 'x', 'it belongs in the first stage');
});

test('stages render in declared order and an empty one still renders', () => {
  const grouped = organiseEgress([]);
  assert.deepEqual(grouped.map(s => s.id), EGRESS_STAGES.map(s => s.id),
    'stage order must follow EGRESS_STAGES, not the topic data');
  assert.equal(grouped.length, EGRESS_STAGES.length, 'an empty stage must not be skipped');
  assert.ok(grouped.every(s => s.topics.length === 0));
});

test('reordering the topics cannot reorder the stages', () => {
  const forward = organiseEgress(TOPICS).map(s => s.id);
  const backward = organiseEgress([...TOPICS].reverse()).map(s => s.id);
  assert.deepEqual(backward, forward, 'the columns moved when the data was reordered');
});

test('topicsInStage returns only that stage', () => {
  for (const stage of EGRESS_STAGES) {
    const got = topicsInStage(TOPICS, stage.id);
    assert.ok(got.every(t => resolveStage(t.stage) === stage.id),
      `${stage.id} picked up a topic from another stage`);
  }
  assert.deepEqual(topicsInStage(null, 'queued'), [], 'no topics is empty, not a crash');
});

test('every stage has a label and a blurb the page can render', () => {
  for (const stage of EGRESS_STAGES) {
    assert.ok(stage.label, `${stage.id} has no label`);
    assert.ok(stage.blurb, `${stage.id} has no blurb`);
  }
  for (const stage of organiseEgress(TOPICS)) {
    assert.ok(stage.label && stage.blurb, `${stage.id} lost its label or blurb in grouping`);
  }
});

test('every topic names a real section and carries what the page shows', () => {
  const ids = new Set(SECTIONS.map(s => s.id));
  for (const topic of TOPICS) {
    assert.ok(topic.id, 'a topic has no id');
    assert.ok(topic.title, `${topic.id} has no title`);
    assert.ok(topic.note, `${topic.id} has no note`);
    assert.ok(ids.has(topic.section), `${topic.id} names section "${topic.section}", which does not exist`);
  }
  assert.equal(new Set(TOPICS.map(t => t.id)).size, TOPICS.length, 'two topics share an id');
});

/* ---- the page side ---- */

test('the queue stays behind dev mode on the page', () => {
  /* The block is the one part of the Blogs page a visitor must not see.
     Both halves matter: the container has to exist for blogs.js to fill,
     and the section around it has to carry the marker the CSS hides. A
     refactor can drop either with no visible symptom — the page renders
     perfectly, just to the wrong audience. */
  const html = fs.readFileSync(path.join(ROOT, 'blogs.html'), 'utf8');

  assert.ok(html.includes('id="egress-queue"'),
    'blogs.html has no #egress-queue container, so the queue renders nowhere');

  const section = html.match(/<section[^>]*id="blogs-egress"[^>]*>/);
  assert.ok(section, 'blogs.html has no #blogs-egress section');
  assert.match(section[0], /data-status="dev"/,
    'the egress section is visible to a live visitor');
});

test('the renderer never reveals the queue itself', () => {
  /* Hiding is the CSS rule's job. If blogs.js started consulting the
     mode it would be a second, weaker gate that a bug could open. */
  const js = fs.readFileSync(path.join(ROOT, 'blogs.js'), 'utf8');
  assert.doesNotMatch(js, /removeAttribute\(\s*['"]data-status['"]\s*\)/,
    'blogs.js must not strip the dev marker');
  assert.doesNotMatch(js, /data-mode/,
    'blogs.js must not decide visibility for itself — the CSS owns that');
});
