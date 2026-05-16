// Mock data for duochat prototype
// Tag inline format: {idea: "term"} {q: "term"} {explore: "term"} {project: "term"} {sub: "maths" | "ai" | "philo"}

window.DUOCHAT_DATA = {
  workspace: {
    name: "the deep workshop",
    member: "ananya"
  },

  channels: [
    { id: "duochat-shift", category: "Text channels", color: "ink" },
    { id: "ideas-and-insights", category: "Text channels" },
    { id: "questions", category: "Text channels" },
    { id: "math-ideas", category: "Text channels" },
    { id: "code-as-a-rag", category: "Projects" },
    { id: "ai-philosophy", category: "explore" },
    { id: "papers-this-week", category: "read" },
    { id: "feed-of-the-day", category: "media" },
  ],

  // chat messages for #duochat-shift (today, Apr 30)
  messages_today: [
    {
      id: "t1",
      author: "ananya",
      avatarColor: "var(--blue)",
      time: "09:12",
      body: [
        { t: "text", v: "morning. picking up where we left off — i want to push on " },
        { t: "tag", kind: "explore", v: "merge-message behaviour" },
        { t: "text", v: " today. " },
        { t: "tag", kind: "question", v: "should merged messages share a discussion or each keep their own" },
        { t: "text", v: "?" },
      ],
      ai: null,
      reactions: [{ glyph: "↑", count: 1 }],
      discussionCount: 0,
    },
    {
      id: "t2",
      author: "rohan",
      avatarColor: "var(--teal)",
      time: "09:14",
      body: [
        { t: "text", v: "share by default. you merge because you mean the same thing — splitting the discussion just creates two half-conversations." }
      ],
      ai: null,
      reactions: [],
      discussionCount: 0,
      mergedWithPrev: false,
    },
  ],

  // chat messages for #duochat-shift (yesterday, Apr 29)
  messages: [
    {
      id: "m1",
      author: "rohan",
      avatarColor: "var(--teal)",
      time: "5:17",
      date: "Apr 29",
      // text uses our inline tag format
      body: [
        { t: "text", v: "ultimately we should shift everything to " },
        { t: "tag", kind: "project", v: "duochat" },
        { t: "text", v: ", our whole workshop, so we don't have any limits." }
      ],
      ai: {
        words: 487,
        time: "5:18",
        text: "the migration cost is mostly psychological — people protect rituals that have served them. start by mirroring, not moving: keep the existing space read-only for two weeks while duochat carries new writes. that way the old conversations stay queryable and the new tool absorbs the team's working rhythm before it's responsible for memory. concretely: a one-way bridge (existing → duochat) lets the team test message density, color-tag adoption, and discussion-panel depth on real traffic without the panic of permanent loss…"
      },
      reactions: [{ glyph: "↑", count: 3 }, { glyph: "✶", count: 1 }],
      discussionCount: 4,
    },
    {
      id: "m2",
      author: "rohan",
      avatarColor: "var(--red)",
      time: "5:24",
      date: "Apr 29",
      body: [
        { t: "text", v: "feature: " },
        { t: "tag", kind: "idea", v: "channel migration" },
        { t: "text", v: " — when i reorganise i shouldn't have to delete and re-upload posts one at a time. drag a thread, drop it into another channel, history follows." }
      ],
      ai: {
        words: 512,
        time: "5:25",
        text: "channel migration is really three problems wearing one hat: (1) message portability — moving the artefact, (2) link preservation — references from other places, and (3) context inheritance — replies and reactions don't lose their parent. the cheap version solves (1) only and breaks the team's trust in the tool. the right version models a message as a hash-identified object that channels hold a reference to, so migration is a pointer move…"
      },
      reactions: [{ glyph: "↑", count: 5 }],
      discussionCount: 7,
    },
    {
      id: "m3",
      author: "ananya",
      avatarColor: "var(--blue)",
      time: "5:31",
      date: "Apr 29",
      body: [
        { t: "text", v: "what if we replaced threads entirely — every message has a " },
        { t: "tag", kind: "explore", v: "discussion subspace" },
        { t: "text", v: ", and we can group messages into a major thread (visible in channel) + minor spills (just for the message)? " },
        { t: "tag", kind: "question", v: "how deep should default nesting go" },
        { t: "text", v: "?" }
      ],
      ai: null,
      reactions: [{ glyph: "↑", count: 4 }, { glyph: "🜂", count: 1 }],
      discussionCount: 3,
    },
    {
      id: "m4",
      author: "rohan",
      avatarColor: "var(--teal)",
      time: "5:34",
      date: "Apr 29",
      body: [
        { t: "text", v: "color tagging: red for ideas, green for questions, blue for explore. for " },
        { t: "tag", kind: "project", v: "projects" },
        { t: "text", v: " we use a highlight instead of color so it reads differently. " },
        { t: "tag", kind: "subject", subject: "maths", v: "maths" },
        { t: "text", v: " " },
        { t: "tag", kind: "subject", subject: "ai", v: "ai" },
        { t: "text", v: " " },
        { t: "tag", kind: "subject", subject: "philo", v: "philosophy" },
        { t: "text", v: " — subjects get their own color stamp." }
      ],
      ai: null,
      reactions: [{ glyph: "↑", count: 7 }, { glyph: "◐", count: 2 }],
      discussionCount: 12,
    },
    {
      id: "m5",
      author: "ananya",
      avatarColor: "var(--blue)",
      time: "6:11",
      date: "Apr 29",
      body: [
        { t: "text", v: "a quick voice tool we keep talking about — " },
        { t: "tag", kind: "idea", v: "podcast-on-this" },
        { t: "text", v: " button to record, transcribe and extract takeaways. press once, talk for 8 minutes, get back a structured note." }
      ],
      ai: {
        words: 498,
        time: "6:12",
        text: "the podcast-on-this feature is interesting because it changes the writing-vs-talking ratio creative teams default to. most ideas die because typing is slower than thinking; voice is faster than thinking, but voice without structure is noise. the structuring step is the whole game. you'd want: speaker diarisation if more than one voice, semantic chunking by topic shift, a short summary header (≤40 words), then bulleted takeaways…"
      },
      reactions: [{ glyph: "↑", count: 6 }, { glyph: "♨", count: 1 }],
      discussionCount: 2,
    },
  ],

  // discussion panel: replies to a specific message
  discussion_m2: [
    { id: "d1", author: "ananya", avatarColor: "var(--blue)", time: "5:28",
      body: [{ t: "text", v: "we should keep edit history per message even on move — otherwise migration silently rewrites the past." }],
      sub_discussion: 2 },
    { id: "d2", author: "rohan",  avatarColor: "var(--teal)",  time: "5:30",
      body: [{ t: "text", v: "+1. and reactions stay attached. " },
             { t: "tag", kind: "question", v: "does the destination channel inherit the source's tag colors" }, { t: "text", v: "?" }],
      sub_discussion: 4 },
    { id: "d3", author: "ananya", avatarColor: "var(--blue)", time: "5:33",
      body: [{ t: "text", v: "no — tags are message-local. channels are containers, not taxonomies." }],
      sub_discussion: 0 },
    { id: "d4", author: "kabir", avatarColor: "var(--orange)", time: "5:41",
      body: [{ t: "text", v: "open question: do we lock the source after migration, or keep a soft pointer?" }],
      sub_discussion: 1 },
  ],

  // Incubation Lab — extracted from chat
  incubations: [
    { id: "i1", kind: "idea", title: "channel migration", source: "#duochat-shift · rohan",
      ai_words: 512, age: "2d", status: "incubating",
      preview: "model a message as a hash-identified object that channels hold a reference to, so migration is a pointer move, not a copy…" },
    { id: "i2", kind: "idea", title: "podcast-on-this button", source: "#duochat-shift · ananya",
      ai_words: 498, age: "2d", status: "incubating",
      preview: "voice is faster than thinking, but voice without structure is noise. the structuring step is the whole game…" },
    { id: "i3", kind: "question", title: "how deep should default nesting go?", source: "#duochat-shift · ananya",
      ai_words: 0, age: "2d", status: "open",
      preview: "no AI response yet — questions stay open until the team answers them. ananya, rohan and kabir are weighing in." },
    { id: "i4", kind: "explore", title: "discussion subspaces vs threads", source: "#duochat-shift · ananya",
      ai_words: 463, age: "2d", status: "incubating",
      preview: "threads enforce linear time; subspaces allow branching context. the cost of subspaces is they require a UI for orientation — which is your problem, not the feature's…" },
    { id: "i5", kind: "project", title: "code-as-a-rag", source: "#projects · rohan",
      ai_words: 0, age: "4d", status: "active",
      preview: "active project — code-as-a-rag is the retrieval prototype that grounds answers in the repo. 3 open questions, 11 messages this week." },
    { id: "i6", kind: "idea", title: "telegram-as-proxy protocol", source: "#duochat-shift · rohan",
      ai_words: 547, age: "2d", status: "wild",
      preview: "a wild idea worth examining seriously: telegram bots already support arbitrary JSON in message payloads. you'd lose end-to-end encryption guarantees but inherit telegram's reach and free infra…" },
    { id: "i7", kind: "question", title: "do reactions become first-class data?", source: "#duochat-shift · kabir",
      ai_words: 0, age: "1d", status: "open",
      preview: "if ↑ means understood, ✶ means revisit, ◐ means half-baked — reactions are tiny structured edits. should they show up in incubation?" },
    { id: "i8", kind: "explore", title: "PERT / CPM as visual chat overlay", source: "#duochat-shift · ananya",
      ai_words: 391, age: "1d", status: "incubating",
      preview: "project management techniques typically live in their own tool. inlining them lets dependencies become first-class messages…" },
  ],

  // Media — today (one per category — calm daily feed) + library (everything)
  media_today: [
    { id: "td1", category: "video", title: "Two-Pass Vision Transformers", source: "youtube · 12 min",
      blurb: "a clean motivation for why two forward passes might beat scaling depth.", done: false },
    { id: "td2", category: "article", title: "The case against threads", source: "rough drafts · 8 min",
      blurb: "argues messaging tools confuse hierarchy with importance. relevant to our nesting debate.", done: false },
    { id: "td3", category: "paper", title: "Branching contexts in cooperative software", source: "arxiv 2403.10481",
      blurb: "formal model of where a conversation should split. theoretical but lucid.", done: true },
    { id: "td4", category: "tweet", title: "if you can't migrate it, you don't own it", source: "@dharmesh · 4h",
      blurb: "one-line provocation that picked up 1.2k replies. worth the rabbit hole.", done: false },
    { id: "td5", category: "video", title: "How DAWs got slow", source: "youtube · 18 min",
      blurb: "tangent — pacing & rhythm in creative tools. analogy to chat tools is real.", done: false, slot: "amazing" },
    { id: "td6", category: "image", title: "kabir's sketch — incubation lab v3", source: "uploaded today",
      blurb: "internal — kabir's first try at the lab card layout. worth a look.", done: false },
  ],
  media_library: [
    { id: "v1", type: "video",   title: "Two-Pass Vision Transformers",       source: "youtube · 12 min",      added: "today",      done: false },
    { id: "v2", type: "video",   title: "Discord migrations — a postmortem",  source: "youtube · 22 min",      added: "yesterday",  done: true },
    { id: "v3", type: "video",   title: "How DAWs got slow",                  source: "youtube · 18 min",      added: "today",      done: false },
    { id: "a1", type: "article", title: "The case against threads",           source: "rough drafts · 8 min",  added: "today",      done: false },
    { id: "a2", type: "article", title: "Notebooks > documents > messages",   source: "substack · 6 min",      added: "2d ago",     done: true },
    { id: "a3", type: "article", title: "Calm software, revisited",           source: "an essay · 5 min",      added: "3d ago",     done: true },
    { id: "t1", type: "tweet",   title: "if you can't migrate it, you don't own it", source: "@dharmesh", added: "today",  done: false },
    { id: "t2", type: "tweet",   title: "the unreasonable effectiveness of margin notes", source: "@vgr", added: "2d ago", done: true },
    { id: "p1", type: "paper",   title: "Branching contexts in cooperative software", source: "arxiv 2403.10481", added: "today", done: true },
    { id: "p2", type: "paper",   title: "Highlighting as structure: marginalia in async teams", source: "Mehta, Iqbal · 2025", added: "1w ago", done: true },
    { id: "i1", type: "image",   title: "incubation-lab.sketch.v3.png",        source: "ananya",                added: "today",      done: false },
    { id: "i2", type: "image",   title: "discussion-panel.draft.png",         source: "kabir",                 added: "today",      done: false },
    { id: "m1", type: "model",   title: "ollama/llama3.1:8b",                  source: "huggingface · 4.7GB",   added: "5d ago",     done: false },
  ],

  // Active reading: a single open document with paragraphs and AI-detected "hard parts"
  // Each hard part has an analogy the AI made on upload.
  active_doc: {
    title: "Distill: Visualizing Memorization in Transformers",
    authors: "Anil, Park, Yu et al · 2024",
    section: "§ 3.2 — what gets memorised",
    progress: 0.62,
    page: 14, totalPages: 22,
    paragraphs: [
      {
        text: "We observe that the model preferentially commits to memory those sequences that recur with low [[contextual variance]] — that is, sentences which arrive in the same neighbourhood of tokens each time. This is consistent with prior work suggesting that memorisation is less a property of the data than of the data's [[distributional flatness]] across training corpora.",
      },
      {
        text: "To probe this we train a 1.4B model on a corpus where we artificially inject duplicate substrings at varying [[token-level positions]] and measure recovery rates under [[prefix-prompting]] — the practice of presenting only the first n tokens at evaluation time. As expected, recovery climbs with duplicates but the relationship is non-linear: doubling duplicates from 8 to 16 yields a sharper increase than doubling from 128 to 256.",
      },
      {
        text: "Interestingly, models trained with [[dropout regularisation]] above 0.15 show flatter memorisation curves. We hypothesise that dropout makes the loss landscape less amenable to the kind of weight specialisation needed to encode exact sequences — though the mechanism by which this happens at scale remains open.",
      },
    ],
    analogies: {
      "contextual variance":  { short: "how much the surrounding words change.", long: "imagine a phrase you only say at one specific moment — like a wedding toast you give the same way each time. low contextual variance is that. high variance is a phrase you say in dozens of different conversations." },
      "distributional flatness": { short: "how evenly the same thing shows up across all your training data.", long: "if a phrase appears once per page in every book vs all in chapter 3 — the first is flat, the second is spiky. flat repetition is easier to remember than spiky repetition." },
      "token-level positions": { short: "where in the sentence (1st word, 2nd word…) a duplicate sits.", long: "if 'the quick brown fox' always appears at the start of a paragraph, it's positionally fixed. if it appears mid-sentence sometimes, mid-paragraph other times, it's not." },
      "prefix-prompting": { short: "showing only the first few words and asking the model to complete the rest.", long: "like reading a friend the first three words of a song lyric and seeing if they finish it. if they do, they've memorised it." },
      "dropout regularisation": { short: "randomly hiding parts of the model during training so it can't over-rely on any one path.", long: "imagine teaching a class but each day a third of the students are absent at random. the others have to actually learn the material instead of leaning on the same few experts." },
    },
    margin_chat: [
      { who: "you", text: "but does the dropout finding hold for smaller models too?", time: "14:02" },
      { who: "ollama", text: "the paper only tests 1.4B — they cite earlier work (Carlini 2022) showing the pattern at 124M but the curve was less pronounced. effect size grows with scale, in their telling.", time: "14:02" },
      { who: "you", text: "what's the practical takeaway", time: "14:04" },
      { who: "ollama", text: "if you want a model that memorises less, dropout > 0.15 helps. but it costs you on tasks where exact recall matters — code generation, factual QA. the trade-off is real, not free.", time: "14:04" },
    ],
  },

  // Explore — per-topic chat (one full conversation loaded)
  topic_chat: {
    topic: "ai-philosophy",
    subject: "philo",
    frontier: "is interpretability a property of the model or the observer?",
    summary: {
      title: "what we understand so far",
      body: "interpretability has two readings. the first treats it as a model property: how legible are the internal activations to a probe. the second treats it as a relational claim: legible to whom, for what purpose, with what background knowledge. the team has been circling the second reading — kabir's 'a neural net is interpretable to a neural net' argument, ananya's pushback that this collapses into solipsism. the open question is whether there's a useful middle ground.",
      lastExpanded: "yesterday",
    },
    curated_links: [
      { kind: "paper", title: "The Mythos of Model Interpretability", source: "Lipton · 2017",        why: "still the cleanest taxonomy of what people mean by the word." },
      { kind: "video", title: "Interpretability is a verb",          source: "Anthropic talk · 34 min", why: "neel nanda's framing — 'we interpret, models don't have interpretability' lines up with our reading." },
      { kind: "article", title: "On opacity",                         source: "an essay · 11 min",       why: "argues opacity is not a defect but a feature of representation systems. spicy." },
      { kind: "tweet",   title: "@ch402: interpretability research is hermeneutics",   source: "twitter", why: "one line, encodes a whole position." },
    ],
    chat: [
      { who: "you", text: "i keep coming back to: if no observer is around to interpret it, is the model interpretable?", time: "yesterday 21:14" },
      { who: "ollama", text: "the question dissolves if you pick a frame. as a model property, the answer is yes (the structure is there). as a relational property, the answer is no (no relation without two relata). the more useful question may be: what observer-model pairs produce useful interpretation?", time: "yesterday 21:14" },
      { who: "you", text: "useful for what though", time: "yesterday 21:17" },
      { who: "ollama", text: "the standard answers are debugging, alignment auditing, scientific understanding. each implies a different observer with different needs. an alignment auditor wants to know 'will it lie' — they don't need to understand the weights, only the behaviours. a mechanistic interp researcher wants the weights themselves to be legible. these aren't the same enterprise.", time: "yesterday 21:17" },
      { who: "ananya", text: "this is the thing kabir kept saying — there isn't one 'interpretability', there are practices.", time: "today 09:02" },
    ],
  },

  // Read — papers & books
  reads: [
    { id: "r1", kind: "paper", title: "Distill: Visualizing Memorization in Transformers", authors: "Anil et al · 2024",
      progress: 0.62, words: 8400, breakdownStatus: "draft", lastTouched: "yesterday" },
    { id: "r2", kind: "paper", title: "On the role of nesting in cooperative protocols", authors: "Park, Yu · 2023",
      progress: 0.18, words: 12200, breakdownStatus: "queued", lastTouched: "3d ago" },
    { id: "r3", kind: "book", title: "Tools for Thought", authors: "Howard Rheingold",
      progress: 0.34, words: null, breakdownStatus: "in-progress", lastTouched: "today" },
    { id: "r4", kind: "paper", title: "Highlighting as structure: marginalia in async teams", authors: "Mehta, Iqbal · 2025",
      progress: 1.0, words: 6200, breakdownStatus: "done", lastTouched: "1w ago" },
    { id: "r5", kind: "book", title: "Seeing Like a State", authors: "James C. Scott",
      progress: 0.08, words: null, breakdownStatus: "queued", lastTouched: "2w ago" },
  ],

  // Explore — topic clusters
  explore: [
    { id: "e1", topic: "ai-philosophy", subject: "philo", count: 47, frontier: "is interpretability a property of the model or the observer?", deep_dives: 14 },
    { id: "e2", topic: "quantum-ml",    subject: "maths", count: 23, frontier: "do parameterised circuits actually learn or just interpolate?", deep_dives: 6 },
    { id: "e3", topic: "type-theory",   subject: "maths", count: 31, frontier: "dependent types vs proof-carrying tests in practice", deep_dives: 9 },
    { id: "e4", topic: "agent-design",  subject: "ai",    count: 62, frontier: "memory architectures beyond rolling-window context", deep_dives: 21 },
    { id: "e5", topic: "design-systems",subject: "ai",    count: 18, frontier: "color as semantic carrier vs decorative layer", deep_dives: 4 },
    { id: "e6", topic: "creative-tools",subject: "philo", count: 29, frontier: "tools that let ideas mature vs tools that surface them too fast", deep_dives: 11 },
  ],

  // Projects
  projects: [
    { id: "p1", name: "duochat", channel: "duochat-shift", openIdeas: 12, openQuestions: 5, nextStep: "design discussion panel", phase: "design" },
    { id: "p2", name: "code-as-a-rag", channel: "code-as-a-rag", openIdeas: 4, openQuestions: 3, nextStep: "benchmark on repo of 50k loc", phase: "build" },
    { id: "p3", name: "gemma-manager", channel: "gemma-manager", openIdeas: 2, openQuestions: 1, nextStep: "ship v0.2 to internal", phase: "build" },
    { id: "p4", name: "anatfor",       channel: "anatfor", openIdeas: 8, openQuestions: 2, nextStep: "interview 3 anatomists", phase: "research" },
  ],

  // Daily AI end-of-day summaries (written at 23:59 before the day rolls over)
  daily_summaries: [
    {
      date: "Apr 29", iso: "2026-04-29",
      headline: "the team converged on duochat as a real shift, not just a venue",
      body: "twelve messages across the morning and evening. rohan opened with the migration urgency and ananya pushed back on the threading model — both lines of thought are unresolved and worth carrying forward. ollama responded first on two ideas (channel migration, podcast-on-this) at a combined 1010 words; both are now active in incubation. the standout question came from ananya: how deep should default nesting go. nobody answered it yet. tomorrow's work probably starts there.",
      writes: 12, hatched: 2, openQs: 3,
    },
    {
      date: "Apr 28", iso: "2026-04-28",
      headline: "scoping the space — five rough sketches, no commitments",
      body: "an exploratory day. kabir surfaced the calmness-by-design framing for media. ananya tied that to read and explore. you posted the first sketch of the incubation lab. ollama suggested margin-notes as a primitive that links read + chat + lab. nothing was decided. nothing needed to be.",
      writes: 8, hatched: 0, openQs: 1,
    },
  ],

  // Project task breakdowns — used by Schedule tab in project workspace
  project_subtasks: {
    "duochat": [
      { name: "design discussion panel", start: 0, span: 2, status: "done" },
      { name: "build dynamic composer", start: 1, span: 2, status: "in-progress" },
      { name: "wire ollama auto-response", start: 3, span: 2, status: "next" },
      { name: "implement merge messages", start: 4, span: 1, status: "next" },
      { name: "ship beta to internal", start: 6, span: 1, status: "milestone" },
    ],
    "code-as-a-rag": [
      { name: "benchmark suite", start: 0, span: 2, status: "done" },
      { name: "embedding model picker", start: 1, span: 2, status: "in-progress" },
      { name: "scale test on 50k loc", start: 3, span: 3, status: "next" },
      { name: "ship to gemma-manager", start: 6, span: 1, status: "milestone" },
    ],
    "gemma-manager": [
      { name: "model swap UI", start: 0, span: 2, status: "in-progress" },
      { name: "v0.2 internal release", start: 3, span: 1, status: "milestone" },
      { name: "quant benchmark", start: 4, span: 2, status: "next" },
    ],
    "anatfor": [
      { name: "interview script", start: 0, span: 1, status: "done" },
      { name: "interview 3 anatomists", start: 1, span: 3, status: "in-progress" },
      { name: "synthesise findings", start: 5, span: 2, status: "next" },
    ],
  },

  // ═══════════════════════════════════════════════
  // PROJECT-SCOPED DATA — each project gets its own
  // chat, incubation, media, reads, and explore
  // ═══════════════════════════════════════════════

  project_data: {
    // ── duochat ──────────────────────────────────
    "duochat": {
      messages_today: [
        {
          id: "dc-t1", author: "rohan", avatarColor: "var(--teal)", time: "10:02",
          body: [
            { t: "text", v: "the composer is coming together but " },
            { t: "tag", kind: "question", v: "how should tag switching animate" },
            { t: "text", v: "? i want it smooth but not distracting." },
          ],
          ai: null, reactions: [{ glyph: "↑", count: 2 }], discussionCount: 0,
        },
        {
          id: "dc-t2", author: "ananya", avatarColor: "var(--blue)", time: "10:08",
          body: [
            { t: "text", v: "crossfade on the input border color — 150ms ease-out. anything faster feels twitchy, anything slower feels laggy." },
          ],
          ai: null, reactions: [], discussionCount: 0,
        },
        {
          id: "dc-t3", author: "kabir", avatarColor: "var(--orange)", time: "10:31",
          body: [
            { t: "tag", kind: "idea", v: "haptic feedback on tag toggle" },
            { t: "text", v: " — mobile only. a subtle pulse when you switch tags so you know it registered without looking at the chip." },
          ],
          ai: {
            words: 374,
            time: "10:32",
            text: "haptic feedback on tag toggle maps well to the 'tactile writing' principle — the writer should feel the tool respond. iOS offers three useful patterns here: selection (light), impact (medium), and notification (heavy). for tag switching, selection-changed is the right call…",
          },
          reactions: [{ glyph: "✶", count: 1 }], discussionCount: 1,
        },
      ],
      incubations: [
        { id: "dc-i1", kind: "idea", title: "haptic feedback on tag toggle", source: "#duochat · kabir",
          ai_words: 374, age: "today", status: "incubating",
          preview: "tactile writing — mobile should pulse on tag switch so you know it registered." },
        { id: "dc-i2", kind: "question", title: "how should tag switching animate?", source: "#duochat · rohan",
          ai_words: 0, age: "today", status: "open",
          preview: "crossfade vs snap vs slide — what transition model matches the writing flow?" },
        { id: "dc-i3", kind: "idea", title: "keyboard shortcuts for tags", source: "#duochat · ananya",
          ai_words: 287, age: "1d", status: "incubating",
          preview: "cmd+1 for idea, cmd+2 for question — desktop power users need muscle memory paths." },
        { id: "dc-i4", kind: "explore", title: "inline markdown in tagged text", source: "#duochat · rohan",
          ai_words: 412, age: "2d", status: "incubating",
          preview: "can you bold/italic inside a tag segment? probably yes but rendering gets tricky." },
      ],
      media_today: [
        { id: "dc-m1", category: "video", title: "Designing Chat Interfaces That Scale", source: "youtube · 14 min",
          blurb: "patterns for multi-threaded conversations — directly relevant to our discussion panel.", done: false },
        { id: "dc-m2", category: "article", title: "Why Slack's threading model failed", source: "substack · 7 min",
          blurb: "argues threading creates context collapse. we want to avoid repeating this.", done: false },
        { id: "dc-m3", category: "paper", title: "Conversational affordances in collaborative tools", source: "CHI 2024",
          blurb: "formalises what makes a chat tool feel 'right'. useful for our design language.", done: true },
      ],
      reads: [
        { id: "dc-r1", kind: "paper", title: "Conversational affordances in collaborative tools", authors: "Singh, Park · 2024",
          progress: 0.45, words: 7100, breakdownStatus: "in-progress", lastTouched: "today" },
        { id: "dc-r2", kind: "article", title: "Why Slack's threading model failed", authors: "rough drafts",
          progress: 1.0, words: 3200, breakdownStatus: "done", lastTouched: "yesterday" },
      ],
      explore: [
        { id: "dc-e1", topic: "composable-chat", subject: "ai", count: 18, frontier: "can a message be a component rather than a string?", deep_dives: 5 },
        { id: "dc-e2", topic: "discussion-depth", subject: "philo", count: 11, frontier: "when does nesting help vs when does it bury context?", deep_dives: 3 },
      ],
    },

    // ── code-as-a-rag ──────────────────────────────
    "code-as-a-rag": {
      messages_today: [
        {
          id: "cr-t1", author: "rohan", avatarColor: "var(--teal)", time: "08:45",
          body: [
            { t: "text", v: "ran the " },
            { t: "tag", kind: "project", v: "embedding benchmark" },
            { t: "text", v: " overnight — nomic-embed-text beats bge-base at 50k tokens but falls behind at 200k. " },
            { t: "tag", kind: "question", v: "should we optimise for the small repo case or the large one" },
            { t: "text", v: "?" },
          ],
          ai: null, reactions: [{ glyph: "↑", count: 3 }], discussionCount: 2,
        },
        {
          id: "cr-t2", author: "ananya", avatarColor: "var(--blue)", time: "09:12",
          body: [
            { t: "text", v: "small repo first. most users won't have 200k token codebases. ship nomic, benchmark large later." },
          ],
          ai: null, reactions: [{ glyph: "↑", count: 1 }], discussionCount: 0,
        },
        {
          id: "cr-t3", author: "rohan", avatarColor: "var(--teal)", time: "09:30",
          body: [
            { t: "tag", kind: "idea", v: "chunk-by-scope, not chunk-by-lines" },
            { t: "text", v: " — the retriever should split on function/class boundaries, not arbitrary line counts. AST-based chunking." },
          ],
          ai: {
            words: 421,
            time: "09:31",
            text: "AST-based chunking is the right direction. tree-sitter gives you language-agnostic scope extraction — you'd parse the file into a syntax tree, walk nodes of type function_definition and class_definition, and emit each as a chunk with its docstring as metadata…",
          },
          reactions: [{ glyph: "↑", count: 4 }], discussionCount: 3,
        },
      ],
      incubations: [
        { id: "cr-i1", kind: "idea", title: "chunk-by-scope (AST-based)", source: "#code-as-a-rag · rohan",
          ai_words: 421, age: "today", status: "incubating",
          preview: "tree-sitter scope extraction for language-agnostic chunking. emit function/class blocks with docstrings." },
        { id: "cr-i2", kind: "question", title: "small repo vs large repo optimisation?", source: "#code-as-a-rag · rohan",
          ai_words: 0, age: "today", status: "open",
          preview: "nomic-embed-text wins at 50k tokens, loses at 200k. which use case do we ship first?" },
        { id: "cr-i3", kind: "explore", title: "hybrid search: embeddings + BM25", source: "#code-as-a-rag · ananya",
          ai_words: 356, age: "3d", status: "incubating",
          preview: "pure vector search misses exact names. BM25 catches them. fuse both with reciprocal rank." },
      ],
      media_today: [
        { id: "cr-m1", category: "video", title: "Tree-sitter in 10 minutes", source: "youtube · 10 min",
          blurb: "walkthrough of incremental parsing — relevant to our AST chunking idea.", done: false },
        { id: "cr-m2", category: "paper", title: "Retrieval-Augmented Generation for Code", source: "arxiv 2401.15268",
          blurb: "the most cited RAG-for-code paper. benchmarks we should replicate.", done: false },
      ],
      reads: [
        { id: "cr-r1", kind: "paper", title: "Retrieval-Augmented Generation for Code", authors: "Li, Chen · 2024",
          progress: 0.28, words: 9400, breakdownStatus: "in-progress", lastTouched: "today" },
        { id: "cr-r2", kind: "paper", title: "Code Embeddings: A Survey", authors: "Zhou et al · 2023",
          progress: 0.72, words: 11200, breakdownStatus: "draft", lastTouched: "2d ago" },
      ],
      explore: [
        { id: "cr-e1", topic: "embedding-models", subject: "ai", count: 34, frontier: "when does semantic similarity fail for code?", deep_dives: 8 },
        { id: "cr-e2", topic: "chunking-strategies", subject: "ai", count: 19, frontier: "AST vs sliding window vs semantic boundaries", deep_dives: 6 },
      ],
    },

    // ── gemma-manager ──────────────────────────────
    "gemma-manager": {
      messages_today: [
        {
          id: "gm-t1", author: "rohan", avatarColor: "var(--teal)", time: "11:20",
          body: [
            { t: "text", v: "v0.2 release is close. " },
            { t: "tag", kind: "idea", v: "one-click model swap" },
            { t: "text", v: " is working but the UI needs polish — the progress bar jumps when switching from 8b to 2b." },
          ],
          ai: null, reactions: [{ glyph: "↑", count: 1 }], discussionCount: 0,
        },
        {
          id: "gm-t2", author: "kabir", avatarColor: "var(--orange)", time: "11:35",
          body: [
            { t: "tag", kind: "question", v: "should we show VRAM usage live" },
            { t: "text", v: "? it would help users decide which quant to pick — but it's noisy." },
          ],
          ai: null, reactions: [], discussionCount: 1,
        },
      ],
      incubations: [
        { id: "gm-i1", kind: "idea", title: "one-click model swap", source: "#gemma-manager · rohan",
          ai_words: 312, age: "today", status: "incubating",
          preview: "seamless swap between gemma variants without restarting ollama. hot-load the weights." },
        { id: "gm-i2", kind: "question", title: "show VRAM usage live?", source: "#gemma-manager · kabir",
          ai_words: 0, age: "today", status: "open",
          preview: "helps pick the right quant level but could overwhelm non-technical users." },
        { id: "gm-i3", kind: "idea", title: "auto-quant recommendations", source: "#gemma-manager · ananya",
          ai_words: 398, age: "2d", status: "incubating",
          preview: "detect GPU memory, suggest the highest quality quant that fits. no manual picking." },
      ],
      media_today: [
        { id: "gm-m1", category: "video", title: "GGUF Quantisation Explained", source: "youtube · 16 min",
          blurb: "clear walkthrough of Q4, Q5, Q8 — helps understand what we're managing.", done: false },
        { id: "gm-m2", category: "article", title: "ollama internals: model loading", source: "blog · 5 min",
          blurb: "how ollama loads and unloads models. relevant to our swap feature.", done: true },
      ],
      reads: [
        { id: "gm-r1", kind: "paper", title: "Efficient Inference with Quantised LLMs", authors: "Dettmers et al · 2023",
          progress: 0.55, words: 8800, breakdownStatus: "in-progress", lastTouched: "yesterday" },
      ],
      explore: [
        { id: "gm-e1", topic: "quantisation", subject: "ai", count: 22, frontier: "where does Q4 quality degrade noticeably?", deep_dives: 7 },
        { id: "gm-e2", topic: "model-management", subject: "ai", count: 15, frontier: "can we pre-warm a model before the user needs it?", deep_dives: 4 },
      ],
    },

    // ── anatfor ──────────────────────────────────
    "anatfor": {
      messages_today: [
        {
          id: "af-t1", author: "ananya", avatarColor: "var(--blue)", time: "14:10",
          body: [
            { t: "text", v: "finished interview #2 with dr. patel. key insight: " },
            { t: "tag", kind: "idea", v: "spatial anchoring for muscle groups" },
            { t: "text", v: " — students learn better when anatomy is pinned to 3D landmarks, not flat diagrams." },
          ],
          ai: {
            words: 445,
            time: "14:11",
            text: "spatial anchoring is a strong pedagogical principle with roots in the method of loci. applied to anatomy, it means the shoulder isn't a list of muscles — it's a landscape where each muscle has a location, a direction, and a neighbour. the teaching implication is that your tool should let students rotate, not scroll…",
          },
          reactions: [{ glyph: "↑", count: 2 }, { glyph: "✶", count: 1 }], discussionCount: 1,
        },
        {
          id: "af-t2", author: "kabir", avatarColor: "var(--orange)", time: "14:28",
          body: [
            { t: "tag", kind: "question", v: "should we build our own 3D viewer or embed an existing one" },
            { t: "text", v: "? three.js is powerful but heavy. maybe start with annotated SVG layers." },
          ],
          ai: null, reactions: [], discussionCount: 2,
        },
        {
          id: "af-t3", author: "rohan", avatarColor: "var(--teal)", time: "14:45",
          body: [
            { t: "text", v: "SVG layers first, 3D later. we need to validate the teaching model before investing in rendering. " },
            { t: "tag", kind: "explore", v: "progressive complexity in anatomy tools" },
            { t: "text", v: " — start simple, add depth only when the learner is ready." },
          ],
          ai: null, reactions: [{ glyph: "↑", count: 3 }], discussionCount: 0,
        },
      ],
      incubations: [
        { id: "af-i1", kind: "idea", title: "spatial anchoring for muscle groups", source: "#anatfor · ananya",
          ai_words: 445, age: "today", status: "incubating",
          preview: "anatomy as landscape — pin muscles to 3D landmarks. the tool should let students rotate, not scroll." },
        { id: "af-i2", kind: "question", title: "build 3D viewer or embed existing?", source: "#anatfor · kabir",
          ai_words: 0, age: "today", status: "open",
          preview: "three.js is powerful but heavy. SVG layers might be enough for v1." },
        { id: "af-i3", kind: "explore", title: "progressive complexity in anatomy tools", source: "#anatfor · rohan",
          ai_words: 376, age: "today", status: "incubating",
          preview: "start with labelled 2D, add layers, graduate to 3D. respect the learner's cognitive load." },
        { id: "af-i4", kind: "idea", title: "quiz-from-diagram generator", source: "#anatfor · kabir",
          ai_words: 291, age: "3d", status: "incubating",
          preview: "auto-generate drag-and-label quizzes from any annotated diagram. spaced repetition built in." },
      ],
      media_today: [
        { id: "af-m1", category: "video", title: "How Medical Schools Teach Anatomy in 2025", source: "youtube · 20 min",
          blurb: "survey of digital tools replacing cadaver labs. relevant benchmarks for our approach.", done: false },
        { id: "af-m2", category: "paper", title: "Spatial cognition in anatomical learning", source: "Anat Sci Ed · 2023",
          blurb: "evidence that 3D mental rotation ability predicts anatomy exam scores.", done: false },
        { id: "af-m3", category: "article", title: "SVG as a teaching medium", source: "blog · 6 min",
          blurb: "lightweight interactive diagrams with hover states. exactly our v1 approach.", done: true },
      ],
      reads: [
        { id: "af-r1", kind: "paper", title: "Spatial cognition in anatomical learning", authors: "Nguyen, Baker · 2023",
          progress: 0.38, words: 6800, breakdownStatus: "in-progress", lastTouched: "today" },
        { id: "af-r2", kind: "book", title: "Gray's Anatomy: The Anatomical Basis of Clinical Practice", authors: "Standring",
          progress: 0.12, words: null, breakdownStatus: "queued", lastTouched: "1w ago" },
        { id: "af-r3", kind: "paper", title: "Interactive 3D models in medical education: a meta-analysis", authors: "Chen et al · 2024",
          progress: 0.85, words: 5400, breakdownStatus: "draft", lastTouched: "2d ago" },
      ],
      explore: [
        { id: "af-e1", topic: "spatial-cognition", subject: "philo", count: 28, frontier: "is 3D rotation a learnable skill or a fixed aptitude?", deep_dives: 9 },
        { id: "af-e2", topic: "anatomy-pedagogy", subject: "ai", count: 16, frontier: "can AI generate better mnemonics than textbooks?", deep_dives: 5 },
        { id: "af-e3", topic: "svg-interactives", subject: "ai", count: 8, frontier: "how much interactivity before an SVG becomes a game?", deep_dives: 2 },
      ],
    },
  },
};
