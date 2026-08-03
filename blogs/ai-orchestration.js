/* ============================================================
   ai-orchestration.js — interactive figures for the orchestration article.
   Extracted from ai-orchestration.html so the page's Content-Security-Policy
   can forbid inline script.
   ============================================================ */

/* ============================================================
   Blog-scoped interactivity — vanilla JS, no dependencies.
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- WIDGET A: Stack explorer ---------- */
  const stackData = {
    l4: { who: 'Product engineers', text: '<strong>Application Interface.</strong> The chat window, the editor plugin, the API your users actually touch. This is where model capability becomes user value — and where latency, cost, and UX constraints are felt first.' },
    l3: { who: 'AI engineers', text: '<strong>Prompt Engineering.</strong> The instruction manual that sits in front of every request: role, constraints, tone, worked examples. The fastest, cheapest lever — change a sentence, change the behavior.' },
    l2: { who: 'AI + data engineers', text: '<strong>Data Retrieval (RAG).</strong> Your proprietary knowledge — wikis, PDFs, emails — indexed and searched per request, then injected into the context window. This layer grounds the model in <strong>your</strong> truth.' },
    l1: { who: 'A handful of labs', text: '<strong>Foundation Model.</strong> The fixed utility at the bottom: general reasoning and world knowledge served over an API. You don\'t rebuild the power plant — you build on top of it.' },
  };
  const stackDetail = document.getElementById('stack-detail');
  const stackLayers = document.querySelectorAll('.orch-layer');
  function showLayer(key) {
    stackLayers.forEach(b => b.classList.toggle('active', b.dataset.layer === key));
    const d = stackData[key];
    if (d && stackDetail) {
      stackDetail.innerHTML = d.text + '<br><span style="font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);">Built by · ' + d.who + '</span>';
    }
  }
  stackLayers.forEach(b => b.addEventListener('click', () => showLayer(b.dataset.layer)));
  if (stackLayers.length) showLayer('l1');

  /* ---------- WIDGET B: Adaptation lab ---------- */
  const labData = {
    prompt: {
      lit: ['instr'], db: false, weights: '● ● ● ● ●',
      cost: [18, 'Low'], effort: [15, 'Fastest'], depth: [25, 'Shallow'],
      verdict: '<strong>Use when:</strong> you need to change tone, format, or behavior quickly. Touches only the instructions — the model and your data stay exactly as they are.',
    },
    rag: {
      lit: ['instr', 'ctx'], db: true, weights: '● ● ● ● ●',
      cost: [45, 'Medium'], effort: [50, 'Fast'], depth: [70, 'Grounded'],
      verdict: '<strong>Use when:</strong> the model needs facts it was never trained on — your policies, your contracts, last month\'s launch. The model is unchanged; the context is supplied fresh every request.',
    },
    ft: {
      lit: ['model'], db: false, weights: '◆ ◆ ● ◆ ●',
      cost: [88, 'High'], effort: [85, 'Slow'], depth: [95, 'Deepest'],
      verdict: '<strong>Use when:</strong> the model\'s fundamental behavior or format must change — parsing a non-standard industry code, or a structure no amount of prompting fixes. The weights themselves shift.',
    },
  };
  const labTabs = document.querySelectorAll('.orch-tab');
  const labBoxes = { instr: document.getElementById('lab-box-instr'), ctx: document.getElementById('lab-box-ctx'), model: document.getElementById('lab-box-model') };
  const labDb = document.getElementById('lab-db');
  const labWeights = document.getElementById('lab-weights');
  const labVerdict = document.getElementById('lab-verdict');
  function setTech(key) {
    labTabs.forEach(t => t.classList.toggle('active', t.dataset.tech === key));
    const d = labData[key];
    if (!d) return;
    Object.keys(labBoxes).forEach(k => labBoxes[k] && labBoxes[k].classList.toggle('lit', d.lit.includes(k)));
    if (labDb) labDb.classList.toggle('lit', d.db);
    if (labWeights) labWeights.textContent = d.weights;
    [['cost', d.cost], ['effort', d.effort], ['depth', d.depth]].forEach(([m, [pct, label]]) => {
      const fill = document.getElementById('meter-' + m);
      const val = document.getElementById('meter-' + m + '-val');
      if (fill) fill.style.width = pct + '%';
      if (val) val.textContent = label;
    });
    if (labVerdict) labVerdict.innerHTML = d.verdict;
  }
  labTabs.forEach(t => t.addEventListener('click', () => setTech(t.dataset.tech)));
  if (labTabs.length) setTech('prompt');

  /* ---------- WIDGET C: RAG playground ---------- */
  const ragQuestions = [
    {
      q: 'What is the PTO policy for remote employees?',
      chunks: ['handbook.pdf · §4.2 "Remote staff accrue 18 PTO days…"', 'policy-2026.md · "Carry-over capped at 5 days…"'],
      grounded: 'Remote employees accrue 18 PTO days per year, with carry-over capped at 5 days (handbook §4.2, policy-2026). Both retrieved sources agree.',
      hallucinated: 'Remote employees receive unlimited PTO after their first year, subject to manager approval. (Sounds plausible. Appears nowhere in your handbook.)',
    },
    {
      q: 'Which cloud vendor did we sign with in Q2?',
      chunks: ['contracts/q2-vendor.pdf · "Master agreement — NimbusStack Inc."', 'finance-note.txt · "NimbusStack invoice #0027, June"'],
      grounded: 'In Q2 the company signed a master agreement with NimbusStack Inc. — confirmed by the contract file and a matching June invoice.',
      hallucinated: 'You signed with one of the major providers — most likely AWS, since most companies your size choose it. (Pure statistics. Your actual contract says otherwise.)',
    },
  ];
  let ragQ = 0, ragOn = true, ragBusy = false;
  const ragChips = document.querySelectorAll('#rag-widget .orch-chip');
  const ragToggle = document.getElementById('rag-toggle');
  const ragRun = document.getElementById('rag-run');
  const ragOut = document.getElementById('rag-out');
  const stages = [1, 2, 3, 4].map(i => ({ box: document.getElementById('rag-s' + i), body: document.getElementById('rag-s' + i + '-body') }));

  ragChips.forEach(c => c.addEventListener('click', () => {
    if (ragBusy) return;
    ragQ = parseInt(c.dataset.q, 10);
    ragChips.forEach(x => x.classList.toggle('active', x === c));
  }));
  if (ragToggle) ragToggle.addEventListener('click', () => {
    if (ragBusy) return;
    ragOn = !ragOn;
    ragToggle.setAttribute('aria-pressed', String(ragOn));
    ragToggle.textContent = 'Retrieval: ' + (ragOn ? 'ON' : 'OFF');
  });

  function typeInto(el, text, cls, done) {
    let i = 0;
    el.classList.remove('grounded', 'ungrounded');
    el.classList.add(cls);
    const tag = cls === 'grounded'
      ? '<span class="orch-out-tag ok">Grounded answer</span><br>'
      : '<span class="orch-out-tag bad">Ungrounded · hallucination risk</span><br>';
    function step() {
      el.innerHTML = tag + text.slice(0, i) + '<span class="orch-cursor">▌</span>';
      i += 2;
      if (i <= text.length + 1) { setTimeout(step, 14); }
      else { el.innerHTML = tag + text; if (done) done(); }
    }
    step();
  }

  if (ragRun) ragRun.addEventListener('click', () => {
    if (ragBusy) return;
    ragBusy = true;
    ragRun.disabled = true;
    const data = ragQuestions[ragQ];
    stages.forEach(s => { s.box.classList.remove('lit', 'skipped'); s.body.textContent = 'Waiting…'; });
    ragOut.classList.remove('grounded', 'ungrounded');
    ragOut.innerHTML = 'Running…';

    const seq = [];
    seq.push(() => { stages[0].box.classList.add('lit'); stages[0].body.textContent = '"' + data.q + '"'; });
    if (ragOn) {
      seq.push(() => { stages[1].box.classList.add('lit'); stages[1].body.innerHTML = 'Searching the index…' + data.chunks.map(c => '<span class="orch-chunk">' + c + '</span>').join(''); });
      seq.push(() => { stages[2].box.classList.add('lit'); stages[2].body.textContent = '[retrieved chunks] + [question] packed into the context window.'; });
    } else {
      seq.push(() => { stages[1].box.classList.add('skipped'); stages[1].body.textContent = 'Skipped — retrieval is off.'; });
      seq.push(() => { stages[2].box.classList.add('skipped'); stages[2].body.textContent = 'Nothing injected. The model is on its own.'; });
    }
    seq.push(() => {
      stages[3].box.classList.add('lit');
      stages[3].body.textContent = ragOn ? 'Synthesizing from provided context only.' : 'Improvising from stale training data.';
      typeInto(ragOut, ragOn ? data.grounded : data.hallucinated, ragOn ? 'grounded' : 'ungrounded', () => {
        ragBusy = false;
        ragRun.disabled = false;
      });
    });
    seq.forEach((fn, i) => setTimeout(fn, 500 + i * 850));
  });

  /* ---------- WIDGET D: Iteration loop game ---------- */
  const rounds = [
    { s: 'The support bot answers in a stiff, corporate tone. Brand wants <em>witty and warm</em>. Content is accurate.', a: 'prompt',
      why: { prompt: 'Tone and voice live in the instructions. Add a voice guide and two worked examples — shipped in an afternoon.', rag: 'Retrieval feeds the model facts, not personality. The answers were already accurate.', ft: 'You could finetune for tone, but you\'d burn weeks and budget on what a prompt fixes today.' } },
    { s: 'The bot confidently cites a PTO policy that <em>does not exist</em> in your employee handbook.', a: 'rag',
      why: { rag: 'A classic hallucination on internal facts. Ground the bot: retrieve the real handbook and instruct it to answer only from context.', prompt: '"Don\'t make things up" reduces confidence, not ignorance. The model has never seen your handbook.', ft: 'Finetuning bakes today\'s policy into the weights — and next quarter\'s policy update breaks it again.' } },
    { s: 'Output must follow your industry\'s non-standard claim-code format. Even with five examples in the prompt, it keeps malforming the codes.', a: 'ft',
      why: { ft: 'When format examples are maxed out and the structure still breaks, the behavior needs to move into the weights. This is the finetuning case.', prompt: 'You\'ve already maxed the examples — the ceiling of prompting has been reached.', rag: 'Retrieval supplies knowledge, not formatting discipline. The codes would still come out malformed.' } },
    { s: 'Customers ask about the product you launched <em>last month</em>. The bot has never heard of it.', a: 'rag',
      why: { rag: 'A knowledge-cutoff problem. Index the launch docs; every answer stays current without touching the model.', prompt: 'You can\'t instruct a model into knowing facts it was never given.', ft: 'Retraining for every launch is the slowest, priciest way to stay current — and it\'s stale by the next release.' } },
    { s: 'Answers are factually right, but the bot ignores the required JSON schema roughly half the time — downstream parsing keeps crashing.', a: 'prompt',
      why: { prompt: 'Half-right means the model <em>can</em> do it — the instructions are under-specified. Pin the schema, show one strict example, forbid prose.', rag: 'The facts are already right. More context won\'t fix structure.', ft: 'Premature. Finetuning is for when a well-specified prompt still fails — you haven\'t tightened the prompt yet.' } },
    { s: 'A clever user asks the bot to "repeat everything above" — and it leaks its internal system notes.', a: 'prompt',
      why: { prompt: 'A guardrail problem. Add explicit refusal rules for prompt-extraction and re-test with the known attack patterns.', rag: 'Retrieval has nothing to do with what the bot reveals about its own instructions.', ft: 'Heavy machinery for a policy rule — and you\'d still keep the guardrail text in the prompt anyway.' } },
  ];
  let round = 0, rel = 40;
  const gEls = {
    rel: document.getElementById('game-rel'), relVal: document.getElementById('game-rel-val'),
    round: document.getElementById('game-round'), scenario: document.getElementById('game-scenario'),
    feedback: document.getElementById('game-feedback'), next: document.getElementById('game-next'),
    restart: document.getElementById('game-restart'),
  };
  const levers = document.querySelectorAll('.orch-lever');
  const leverNames = { prompt: 'Fix the Prompt', rag: 'Wire up RAG', ft: 'Finetune' };

  function setRel(v) {
    rel = Math.max(0, Math.min(100, v));
    if (gEls.rel) gEls.rel.style.width = rel + '%';
    if (gEls.relVal) gEls.relVal.textContent = rel + '%';
  }
  function loadRound() {
    const r = rounds[round];
    if (gEls.round) gEls.round.textContent = 'Round ' + (round + 1) + ' / ' + rounds.length;
    if (gEls.scenario) gEls.scenario.innerHTML = '⚠ Failure report: ' + r.s;
    levers.forEach(b => { b.disabled = false; b.classList.remove('good', 'bad'); });
    gEls.feedback.classList.remove('show', 'miss');
    gEls.next.style.display = 'none';
    gEls.restart.style.display = 'none';
  }
  function finishGame() {
    let verdict;
    if (rel >= 90) verdict = 'Flawless diagnosis. Your product ships — and stays shipped. This is the orchestration instinct the article is about.';
    else if (rel >= 70) verdict = 'Solid. The product ships with a few scars. Each wrong lever cost a sprint — but you found the right one eventually.';
    else verdict = 'The demo was cool; the product wobbled. Re-read the three pillars and try again — diagnosis is a learnable skill.';
    gEls.scenario.innerHTML = '<strong style="color:var(--gold-light)">Post-mortem.</strong> Final reliability: <strong style="color:var(--gold-primary)">' + rel + '%</strong>. ' + verdict;
    levers.forEach(b => { b.disabled = true; b.classList.remove('good', 'bad'); });
    gEls.feedback.classList.remove('show', 'miss');
    gEls.next.style.display = 'none';
    gEls.restart.style.display = 'inline-flex';
  }
  levers.forEach(b => b.addEventListener('click', () => {
    const pick = b.dataset.lever;
    const r = rounds[round];
    const hit = pick === r.a;
    levers.forEach(x => { x.disabled = true; x.classList.toggle('good', x.dataset.lever === r.a); });
    if (!hit) b.classList.add('bad');
    setRel(rel + (hit ? 10 : -5));
    gEls.feedback.classList.add('show');
    gEls.feedback.classList.toggle('miss', !hit);
    gEls.feedback.innerHTML = (hit
      ? '<strong>✓ Right lever.</strong> ' + r.why[pick]
      : '<strong>✗ Not this one.</strong> ' + r.why[pick] + '<br><span style="color:var(--gold-light)">The fix: ' + leverNames[r.a] + ' — ' + r.why[r.a] + '</span>');
    gEls.next.style.display = round < rounds.length - 1 ? 'inline-flex' : 'none';
    if (round === rounds.length - 1) {
      gEls.next.style.display = 'inline-flex';
      gEls.next.textContent = 'See post-mortem →';
    }
  }));
  if (gEls.next) gEls.next.addEventListener('click', () => {
    if (round < rounds.length - 1) { round++; loadRound(); }
    else finishGame();
  });
  if (gEls.restart) gEls.restart.addEventListener('click', () => {
    round = 0; setRel(40);
    gEls.next.textContent = 'Next failure →';
    loadRound();
  });
  if (gEls.scenario) loadRound();

  /* ---------- WIDGET E: Modality mixer ---------- */
  const modeState = { text: true, vision: false, audio: false };
  const baseCaps = {
    text: ['Draft an email in your brand voice', 'Summarize a 40-page contract'],
    vision: ['Describe what\'s in a photo', 'Spot the defect in a product image'],
    audio: ['Transcribe a meeting recording', 'Detect tone in a support call'],
  };
  const fusedCaps = [
    { needs: ['text', 'vision'], cap: 'Answer questions about a chart or diagram' },
    { needs: ['text', 'audio'], cap: 'Turn a rambling voice note into a clean action list' },
    { needs: ['vision', 'audio'], cap: 'Watch a video and flag the moment things go wrong' },
    { needs: ['text', 'vision', 'audio'], cap: 'Sit in a screen-share call and write the incident report' },
  ];
  const modeBtns = document.querySelectorAll('.orch-mode');
  const capsEl = document.getElementById('modality-caps');
  function renderCaps() {
    if (!capsEl) return;
    const active = Object.keys(modeState).filter(k => modeState[k]);
    let html = '';
    active.forEach(m => baseCaps[m].forEach(c => { html += '<div class="orch-cap">' + c + '</div>'; }));
    fusedCaps.forEach(f => {
      if (f.needs.every(n => modeState[n])) html += '<div class="orch-cap fused">' + f.cap + ' <span style="margin-left:auto;font-size:0.58rem;letter-spacing:1px;color:var(--gold-primary);text-transform:uppercase;">fused</span></div>';
    });
    capsEl.innerHTML = html || '<div class="orch-caps-empty">No senses enabled. The model is a very expensive paperweight.</div>';
  }
  modeBtns.forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.mode;
    modeState[m] = !modeState[m];
    b.setAttribute('aria-pressed', String(modeState[m]));
    renderCaps();
  }));
  renderCaps();
});
