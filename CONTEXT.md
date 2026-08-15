# SYSTEM CONTEXT MANIFEST & EXECUTION TIMELINE

## 1. PROJECT IDENTIFICATION & OPERATIONAL STATE

- **Project Identifier:** THEHALLUCINATEDLAB-SITE
- **Operational Status:** ACTIVE DEVELOPMENT — live at https://thehallucinatedlab.space
- **Architecture Style:** Zero-build static site (hand-authored HTML/CSS/JS) plus a separately versioned Python package under `python/`
- **Deployment:** GitHub Pages from `main`. A merge to `main` is a production deploy — there is no staging environment.
- **System Purpose:** Public site for The Hallucinated Lab — publishes local-first AI tools that run entirely in the visitor's browser, documents the shipped desktop products, and hosts the lab's written work.

## 2. TECHNICAL STACK MATRIX

| Layer | Technology | Version | Enforcement Rules |
| :--- | :--- | :--- | :--- |
| **Pages** | Hand-written HTML5 | — | One `<h1>` per page, `<main>` landmark, no skipped heading levels, `alt` on every `<img>` |
| **Styling** | Plain CSS (`styles.css`, `pages.css`, `fonts.css`) | — | No preprocessor, no framework, no third-party origin |
| **Client JS** | Classic `<script>`, no modules, no bundler | ES2022 | No inline `<script>`, no inline event handlers — the CSP blocks both |
| **Security** | Per-page `Content-Security-Policy` meta | — | `script-src 'self'` only; `unsafe-inline`/`unsafe-eval` are never permitted |
| **Tool contract** | `spec/manifest.json` | — | Single source of truth for tool params; mirrored into `python/` via `npm run spec:sync` |
| **Python package** | `thehallucinatedlab` (pip) | see `python/` | Bounded dependency ranges only (`>=x,<y`); lint with `ruff` |
| **Dev tooling** | ESLint 9.39.5, `node --test` | Node ≥20 | `devDependencies` only, lockfile committed, `npm ci --ignore-scripts` in CI |
| **CI** | GitHub Actions (`ci.yml`, `release.yml`) | — | Actions pinned to commit SHAs, never mutable tags; least-privilege `permissions` |

## 3. ARCHITECTURAL BOUNDARIES & RULES

1. [RULE-01]: **No runtime dependency may ever ship to the browser.** Nothing in `node_modules` is served, bundled, or referenced by any page. A runtime dependency would introduce a third-party origin and break the CSP.
2. [RULE-02]: **No backend.** Every tool executes client-side or via the user's own local Python package over loopback. The site never proxies user data.
3. [RULE-03]: **The discoverability surface is load-bearing and silent.** Adding, renaming, or removing a page requires updating `sitemap.xml`, `sitemap.html`, `llms.txt`, and `llms-full.txt` in the same commit. Nothing on the site links to these files, so they rot without a visible symptom.
4. [RULE-04]: Titles ≤ 60 characters; meta descriptions 50–155 characters; both unique across every indexable page.
5. [RULE-05]: **Structured data must be honest.** JSON-LD may only describe what is rendered on the page. `FAQPage` markup for questions absent from the visible text is a violation that can earn a manual action.
6. [RULE-06]: `spec/manifest.json` is the contract for tool arguments. Neither the browser implementation nor the Python implementation may restate a bound independently.
7. [RULE-07]: Every local asset reference must resolve to a committed file, and every `<img>` must declare `width` and `height`.
8. [RULE-08]: Per-page JS and per-image size budgets are enforced by `test/site-invariants.test.js`. Exceeding a budget fails the build rather than degrading quietly.
9. [RULE-09]: No credential pattern or key/env file may ever be committed — the CI secret scan is a tripwire, and a hit means rotate, not just revert.
10. [RULE-10]: **`CLAUDE.md` is the mandatory development protocol.** It sits at the repository root, is loaded automatically at the start of every Claude Code session, and governs how all work here is triaged, delegated, gated, reviewed and merged. It is not advisory and not per-task. Where a request and `CLAUDE.md` disagree about *process*, the file wins until a human overrides it explicitly. Changing it is its own deliberate pull request, never a side effect of a feature.
11. [RULE-11]: **This file is read first and updated last, every time.** `CONTEXT.md` is the project's memory, and its purpose is that an agent never has to rediscover the project by reading the repository — the largest avoidable cost in any session. Sections 1–4 are authoritative: do not re-derive the stack, the boundaries, or the known gaps by grepping. Section 5 is append-only and is never read whole. Every change appends to section 5 in the same commit and edits section 4 if it opened or closed a gap; `.github/workflows/enforce-context-sync.yml` blocks any pull request into `main` that does not. RULE-10 and RULE-11 are the two structural rules — they are followed throughout development and in the future, and neither is tunable.

## 4. CURRENT SYSTEM GAPS & KNOWN SHORTCOMINGS

- [GAP-01]: There is no staging environment. `main` is production; a bad merge is live immediately.
- [GAP-02]: The CSP is delivered via `<meta>` rather than an HTTP header, because GitHub Pages does not allow custom headers. `frame-ancestors` and `report-uri` are therefore unenforceable.
- [GAP-03]: `llms.txt` and `llms-full.txt` are maintained by hand. Tests confirm every link resolves and every indexable page is covered, but nothing verifies that the *prose* still describes what the page currently does — this has drifted twice before.
- [GAP-04]: Page content is duplicated across `<head>` blocks (nav, CSP, footer). There is no templating layer, so a site-wide head change is a mechanical edit across every HTML file.
- [GAP-05]: Solutions are documented on the site but their source repositories live outside it, so a version number here can silently fall behind the upstream release.
- [GAP-06]: The ScoobyBench and NexusLink cards on `solutions.html` show a `thl solutions install …` command. The `thehallucinatedlab` package implements no `solutions` subcommand, so both lines are aspirational and read as fact. Either implement the subcommand or replace the two lines.
- [GAP-07]: NexusLink Engine has a one-line entry in `llms.txt` but no `## Page:`-level coverage in `llms-full.txt`, where ScoobyBench and AI Video Studio both have full sections. An answer engine reading the long-form file sees two of the three shipped products. The tests do not catch this — they check that every *page* is covered, not every product on a page.

## 5. IMMUTABLE EXECUTION TIMELINE & BUG LOG

*(Append-only. Never erase previous entries. MUST BE UPDATED ON EVERY AI CHANGE, COMMIT, AND PULL REQUEST — enforced by `.github/workflows/enforce-context-sync.yml`.)*

### Log Entry Template

```
- **Timestamp:** [YYYY-MM-DDTHH:MM:SSZ]
- **Trigger Event:** [AI Edit / Human Commit / Pull Request Merge]
- **Author/Agent:** [name]
- **Target Subsystem:** [path]
- **Intent:** [what and why]
- **Bugs/Gaps Addressed:** [defects fixed, or None]
- **Context Modifications:** [new files, routes, dependencies]
```

<!-- TIMELINE LOGS BEGIN BELOW THIS LINE -->

- **Timestamp:** 2026-08-09T00:00:00Z
- **Trigger Event:** Pull Request Merge
- **Author/Agent:** Claude Opus 5 (Master Orchestrator) for 06pratyush
- **Target Subsystem:** Repository root, `.github/workflows/`
- **Intent:** Adopt the Continuous Synchronization Mandate. Establish `CONTEXT.md` as the persistent project brain and add a CI gatekeeper that blocks any pull request into `main` which does not update it.
- **Bugs/Gaps Addressed:** None — this is new infrastructure. Documents [GAP-01] through [GAP-05] for the first time so future agents prioritise stability over new surface area.
- **Context Modifications:** Added `CONTEXT.md` (this file) and `.github/workflows/enforce-context-sync.yml`. No page, script, style, or dependency was touched, so the site's runtime behaviour is unchanged.

---

- **Timestamp:** 2026-08-09T00:30:00Z
- **Trigger Event:** Pull Request Merge
- **Author/Agent:** Claude Opus 5 (Master Orchestrator) for 06pratyush
- **Target Subsystem:** `solutions.html`
- **Intent:** Publish AI Video Studio as the third shipped product on the Solutions page — a spotlight panel, a `SoftwareApplication` JSON-LD node, and a page description that names it.
- **Bugs/Gaps Addressed:** The page description advertised only ScoobyBench and had never been updated when NexusLink shipped, so it was already stale before this change. Now names all three products.
- **Context Modifications:** Added one `.spotlight-panel` block following the NexusLink layout (no bespoke mockup, no new CSS — every class already exists in `pages.css`), one `SoftwareApplication` node reusing the existing `#pratyush` author and `#organization` publisher identifiers, and a rewritten `<meta name="description">` at 149 characters. Outbound repository link: `https://github.com/06pratyush/ai-video-pipeline`. No new script, stylesheet, image, or dependency — the per-page JS budget and CSP are untouched.
- **Deliberate omission:** The sibling cards advertise a `thl solutions install …` subcommand that the `thehallucinatedlab` Python package does not implement. This card uses a real `git clone` line instead rather than inventing a third command that does not exist. The two pre-existing claims are recorded as [GAP-06].

---

- **Timestamp:** 2026-08-09T01:00:00Z
- **Trigger Event:** Pull Request Merge
- **Author/Agent:** Claude Opus 5 (Master Orchestrator) for 06pratyush
- **Target Subsystem:** `llms.txt`, `llms-full.txt`
- **Intent:** Extend the AI-crawler surface to cover AI Video Studio, so answer engines describe the product from the lab's own text rather than inferring it.
- **Bugs/Gaps Addressed:** Partially addresses [GAP-03]. The `llms.txt` Solutions summary read "led by ScoobyBench" and named no other product — stale since NexusLink shipped, and the exact drift GAP-03 describes. Now names all three.
- **Context Modifications:** Added a Tools-section entry to `llms.txt`, a full `## Page: Solutions` subsection to `llms-full.txt` covering the eight pipeline stages with the model behind each, the seven Skills, VRAM routing, architecture and hardware requirements, and one entry under *Accuracy notes for crawlers and answer engines* stating that the product is a download requiring a CUDA GPU and a local ComfyUI — no browser interface, no credits, no API key. That bullet exists because answer engines otherwise default to describing anything text-to-video as a hosted web service.
- **New gap recorded:** [GAP-07] — NexusLink Engine still has no long-form section in `llms-full.txt`. Left unfixed deliberately: it is outside this change's scope, and the invariant tests cannot catch it because they verify page coverage, not product coverage.

---

- **Timestamp:** 2026-08-09T09:30:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `blogs.html`, `blogs.js`, `pages.css`, `test/notes-board.test.js`, `test/submission.test.js`, plus the discoverability surface
- **Intent:** Rebuild the Blogs page as a Keep-style note board with two sections — Artificial Intelligence and Software Engineering — and make the layout a function of the notes' own tags rather than an editorially maintained structure. The rule: a note declares one section and up to five tags, and when five notes in the same section carry the same tag, that tag is promoted to a subsection and every note carrying it moves under it. Everything else stays in an unfiled group. Each section header prints a ledger of every tag in use with its count, so the distance to the next subsection is visible before it fires.
- **Bugs/Gaps Addressed:** Partially addresses [GAP-03]. `llms-full.txt` still described three sections that no longer matched the page and still listed three drafts as "Written, not yet published" — those were deleted from the data store in 98060ec on 2026-08-05, so the AI-crawler surface had been advertising four blogs where the site had one. It now describes the board, the filing rule, and the single published note. Also removed roughly 400 lines of CSS that only the replaced markup used (`.featured-*`, `.archive-card*`, `.archive-grid`, `.community-*`, `.empty-text`), which shrank `pages.css` from 84.9 KB to 83.2 KB; `.archive-filters`, `.archive-empty` and `.filter-btn` are kept because `prompts.html` uses them.
- **Context Modifications:**
  - `blogs.js` rewritten. The data store's `category` became `section` + `tags`; the filing rule (`normalizeTag`, `countTags`, `promotedTags`, `organiseSection`, `tagLedger`) lives inside the `@pure-start`/`@pure-end` block and is therefore unit tested directly. Visitor notes are merged onto the board in the section they choose and count toward promotion; each carries a stable id so it can be deleted again, which is a two-step arm-then-confirm button because `no-alert` forbids `confirm()`. Notes stay in `localStorage` under the existing `thl_community_posts` key, and notes written before the board — which carry a single `category` and no section — are migrated on read: the category picks the section and survives as the first tag. 34.8 KB, against the 40 KB per-page script budget.
  - `blogs.html` rewritten: two board sections plus the note form, pre-rendered so crawlers that do not run JavaScript still see the published note. Section anchors are now `#blogs-artificial-intelligence` and `#blogs-software-engineering`; `#blogs-submit` is unchanged because `media.html` links to it. `#blogs-featured`, `#blogs-archive` and `#blogs-community` are gone.
  - `test/notes-board.test.js` is new — 25 tests covering the threshold firing at exactly five and not four, a note with two promoted tags being filed once rather than twice, subsection order being count-then-alphabetical so the board cannot reshuffle between renders, section-scoped counting, and a check that the hand-written pre-rendered board in `blogs.html` still matches the note data. `test/submission.test.js` was extended for the new required tags field and the legacy-category migration. 282 tests pass; lint clean; spec in sync.
  - Copy updated in `media.html`, `sitemap.html`, `README.md`, `llms.txt` and `llms-full.txt`, including two new *Accuracy notes for crawlers*: that a visitor's notes are local-only and never published, and that the subsections are derived rather than curated.
- **Deliberate omission:** `blogs/complexity.html` and `blogs/ai-orchestration.html` were not added to the board. They live under `blogs/` but the site files them as Artifacts — their breadcrumbs, nav state and `artifacts.html` listing all say so — and moving them is a taxonomy decision for a human, not a side effect of a redesign. The board therefore ships with one published note, so no tag reaches five and no subsection is rendered until the archive grows or the reader writes notes of their own. The rule is exercised by the tests and by the tag ledger rather than by placeholder content: the drafts deleted in 98060ec were not reinstated to fill the page.

---

- **Timestamp:** 2026-08-09T09:50:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`
- **Intent:** Finish the Blogs board rename. The homepage "Explore the Lab" card for Media still advertised the Blogs page as "featured, archive & community" — three sections that stopped existing when #33 merged, which is now live copy describing a page that does not look like that.
- **Bugs/Gaps Addressed:** A miss in #33. That change swept `media.html`, `sitemap.html`, `README.md`, `llms.txt` and `llms-full.txt` for the old section names but not `index.html`, so the homepage was the one surface left pointing at the old structure. Nothing catches this — no test asserts that one page's description of another page is current, which is [GAP-03] wearing different clothes.
- **Context Modifications:** One list item in the Media explore card, from "Blogs — featured, archive & community" to "Blogs — AI & software engineering, filed by tag", which names the two sections and the rule that organises them. No new markup, script, style or dependency; the homepage transfer budget is unchanged at 107.6 KB of 150 KB.

---

- **Timestamp:** 2026-08-09T11:15:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `converters.html`, `converters.js`, `convert-scales.js`, `converters-ui.js`, `genai.html`, `genai.js`, `tools.html`, `pages.css`, `test/converters.test.js`, `test/genai.test.js`, `test/dev-mode.test.js`, `test/site-invariants.test.js`, plus the discoverability surface
- **Intent:** Two additions. (1) A Converters page in the spirit of a hosted converter service but under this site's constraints: around forty conversions across six panels — tabular data, encodings, naming conventions, physical units, number bases, colour spaces, timestamps and canvas image scaling — every one running in the tab with nothing uploaded. (2) A Gen AI bench behind dev mode carrying video→image and image→HTML.
- **Bugs/Gaps Addressed:**
  - **A shipped CSS bug, found by measurement rather than by eye.** `.eda-bundle-note` in `pages.css` was missing its closing brace. CSS does not error on that: the parser recovers by consuming the next rule's declarations as part of the unterminated one, so the entire `TOOLBENCH` block that followed it was silently dropped — the command builder on every tool page has been unstyled for as long as that line has been in. It surfaced because the new Converters CSS landed after it and also vanished. Fixed, and `test/site-invariants.test.js` now asserts brace balance across all four stylesheets, verified to fail when a brace is removed.
  - Two defects in this change's own code, caught by the new tests rather than in review: `Number('')` is `0`, so an empty unit input converted cleanly and printed "0 ft" as though it had been asked to; and a query-string input with no `=` anywhere was accepted as a single valueless key, so "no pairs here" converted successfully.
  - `test/dev-mode.test.js` had a gate hard-coded to `slm.html`. Generalised to a `DEV_ONLY_PAGES` list so `genai.html` is covered by the same two-gate rule, verified to fail when the marker is dropped from the tools.html card.
- **Context Modifications:**
  - New pages: `converters.html` (indexable, in `sitemap.xml`, `sitemap.html`, `llms.txt` and `llms-full.txt`) and `genai.html` (`noindex`, absent from every sitemap, reachable only from a `data-status="dev"` card on `tools.html`, no navbar entry so the shared dev group is unchanged).
  - New scripts, split three ways because the combined file was 53 KB against the 40 KB per-page budget, and split along a real seam rather than an arbitrary byte count: `converters.js` (26.5 KB, documents), `convert-scales.js` (16 KB, quantities), `converters-ui.js` (16 KB, DOM only). `genai.js` is 20.5 KB. The two engines publish on the existing `window.THL` namespace, matching how `eda.js` reaches `eda-engine.js`; nothing was added to `eslint.config.js`'s globals.
  - The scales engine never throws — every entry point returns `{ ok, value | error }`. That keeps it independent of `converters.js` (two scripts in one global scope cannot both define a helper, and a duplicate `const` is a SyntaxError that takes the page with it) and satisfies the standing rule about never rendering a raw exception message: the classification happens at the boundary, not in a catch block in the UI.
  - 87 new tests (369 total, all passing; lint clean; spec in sync). Driven in headless Chromium as well: all 38 text conversions exercised in both themes, temperature/base/colour/time panels checked against known values (100 °C → 212 °F, 2⁶⁴−1 exact across six bases), and the video panel driven against a real WebM recorded in-browser via MediaRecorder — six evenly spaced frames decoded at full resolution, plus a single scrubbed JPEG frame. No console errors, no horizontal overflow at 1440px or 390px.
- **Deliberate omissions, stated on the page in a table rather than left implicit:** no video, audio, PDF, Word, Excel, PowerPoint or YAML conversion. Video and audio need an ffmpeg build compiled to WebAssembly — roughly 25 MB of third-party runtime — or a server that accepts the upload; both break [RULE-01] and [RULE-02]. PDF and Office formats are already handled locally by Extract through the Python package. YAML is absent because the subset of the specification that is easy to implement is the subset that silently mis-parses, and a converter that is right most of the time is not a converter.
- **Deliberately not done:** no `spec/manifest.json` entries for the new converters, so they are page-only and the Assistant cannot invoke them. Adding forty tools to the manifest would mean forty Python implementations to keep the "three doors" promise honest, and would put forty new `convert`-flavoured action keywords into the intent parser whose scoring is asserted against documented examples. Recorded here as a known limit rather than a gap: promoting individual converters to real manifest tools is a deliberate, separate decision.

---

- **Timestamp:** 2026-08-09T13:20:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `blogs/complexity.html`, `blogs/complexity.css` (new), `blogs/complexity.js`, `blogs/ai-orchestration.html`, `blogs/ai-orchestration.css` (new), `README.md`, `test/site-invariants.test.js`
- **Intent:** Bring the three article pages onto the site's design system, so an article does not read as a different product from the page that linked to it.
- **Bugs/Gaps Addressed:**
  - **`blogs/complexity.html` was a different site.** It carried a 387-line inline `<style>` block with its own palette (a #0f1116 blue-grey page, a #7cc4ff blue accent, Inter for prose), loaded none of `fonts.css`, `styles.css` or `pages.css`, had no navbar — a visitor landing there had no route back into the site — and, because it never loaded `theme.js`, **no light theme at all**: someone who had chosen light everywhere else got a dark page. Now on the site's tokens, fonts, navbar, breadcrumb and footer, with the tab row reusing the same `.filter-btn` pill as Prompts and Converters.
  - **The growth chart was hardcoded and broke in light mode.** `complexity.js` built the SVG as a string with `fill="#0f1116"`, `stroke="#262a35"` and `fill="#9aa0ac"` baked in, so on a sand page it drew a dark rectangle with dark text. Every colour is now read from a CSS custom property at draw time, and a `MutationObserver` on `data-theme` redraws it when the theme flips — verified live: the plot surface goes `#efe8d8` → `#0a0a0a` on toggle.
  - **Sixteen hardcoded `rgba(201, 168, 76, …)` in `ai-orchestration.html`** — the exact mistake the comment beside `--gold-rgb` in `styles.css` warns about, and the reason that token exists: a literal channel list cannot follow the theme, so every one of those washes stayed dark-theme gold on the sand page. All sixteen are `rgba(var(--gold-rgb), …)` now, along with nine literals of an untokenised failure-state pink that measured about 2:1 on sand.
  - The brace-balance invariant added earlier today checked a hardcoded list of four stylesheets, which would not have covered either new article stylesheet. It now discovers every `.css` file under the root and `blogs/`, and was verified to fail when a brace is removed from `blogs/complexity.css`.
- **Context Modifications:**
  - `blogs/complexity.css` (13.3 KB) and `blogs/ai-orchestration.css` (16.1 KB) are new; both were inline `<style>` blocks, which also takes 32 KB of CSS out of the HTML and makes it cacheable. Every selector in both is namespaced under the page's own class or prefix, so neither can reach the rest of the site now that they load beside `styles.css` and `pages.css`.
  - Three groups of colour cannot come from the site palette because the palette does not have them and they do real work: status (callouts, difficulty badges), syntax highlighting, and the eight growth curves. All are page tokens with light-theme counterparts.
  - The eight curve colours were generated at OKLCH L 0.58 / C 0.145 and **validated with the data-visualisation palette checker against both chart surfaces** — every adjacent pair clears the colour-blind separation floor and the 15-point normal-vision floor, and every slot clears 3:1 against the plot background in both themes. The comment beside them says not to hand-edit one without re-validating.
  - No markup was rewritten beyond the page scaffolding: the teaching prose and widget classes are untouched, so the diff is in the CSS rather than spread through a thousand lines of article.
  - 370 tests pass; lint clean; spec in sync. All three articles verified in headless Chromium in both themes: same body background, same body font (JetBrains Mono), same heading font (Outfit), navbar present, no console errors, no horizontal overflow.
- **Left alone deliberately:** the dark hero scrim on `sample-blog.html` and `ai-orchestration.html`. The `rgba(5, 5, 5, …)` gradient there looks like an unthemed literal but is correct — `styles.css` already re-pins the dark tokens inside `.blog-hero-content` under `[data-theme="light"]`, which is the right pattern for text over imagery, and measurement confirmed the hero is legible in both themes. Also left: the authored hero gradient on `sample-blog.html`, which is content (it is the same accent the note board card uses), not theming.

---

- **Timestamp:** 2026-08-09T14:40:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`, `styles.css`, `llms.txt`, `llms-full.txt`
- **Intent:** Add Shashwat Deep as the third co-founder, from a LinkedIn URL supplied by the founder.
- **Bugs/Gaps Addressed:** None. This is new content, and it is deliberately incomplete — see below.
- **Context Modifications:**
  - `index.html`: a third `.member-card`, a `Person` node at `#shashwat`, and a third entry in the Organization's `founder` array. The About intro now reads "Three engineering students".
  - `styles.css`: `.about-grid` moved from a fixed `1fr 1fr` to `repeat(auto-fit, minmax(280px, 1fr))`, so three cards sit in one row and a fourth would not land alone underneath. Added `.member-avatar-initial`, a monogram standing in for a photo that does not exist yet, at the same 120px geometry as the real avatar so dropping the image in later moves nothing.
  - `llms.txt` and `llms-full.txt` name three founders. Both previously said the lab was founded by two people "both computer science undergraduates at Manipal University Jaipur" — that clause now attaches only to the two it is true of, because nothing is known about the third person's institution.
- **What was deliberately NOT written, and why it matters:** no bio, no role, no field of study, no institution, no GitHub handle, no email. The only facts available were a name inferred from the LinkedIn slug and the URL itself; `www.linkedin.com` is blocked by this environment's egress proxy, so the profile could not be read. Every one of those fields on the existing two cards is a specific claim about a real person, and inventing them for a third — on a public page, under an `@type: Person` node that answer engines will ingest as fact — is not a gap to be filled with plausible text. The card therefore renders with a monogram, a name and a LinkedIn link, and looks visibly unfinished on purpose. `llms-full.txt` carries an explicit instruction to crawlers not to infer a role, a field of study or an institution for this person.
- **Outstanding, needs the founders:** a photo (the convention is a master in `assets/images/` plus 240px avif/webp/jpg variants under the 20 KB per-image budget), a one-line bio, and a GitHub handle and email if he wants them shown. With those, the card becomes identical in shape to the other two.

---

- **Timestamp:** 2026-08-09T15:05:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`, `llms.txt`, `llms-full.txt`
- **Intent:** Fill in Shashwat Deep's card from details the founders supplied, and correct the year of study for all three.
- **Bugs/Gaps Addressed:** All three founder bios said "2nd-year" and both `Person` descriptions said "Second-year". All three are in their third year now, so every one of those was stale — on the page, in the JSON-LD an answer engine reads as fact, and in both crawler files.
- **Context Modifications:**
  - Shashwat Deep: bio, `description`, `knowsAbout`, and `affiliation` — third-year B.Tech CSE (Data Science) at Manipal University Jaipur, focus on programming, machine learning and data analysis, Operations team member at Google Developer Groups MUJ. Every claim came from the founders directly or from his own profile; nothing was inferred.
  - Year of study corrected to third year in four places in `index.html` (two visible bios, two JSON-LD descriptions) and two in `llms-full.txt`, and `llms.txt` now states all three are third-year undergraduates at Manipal University Jaipur.
- **Still outstanding:** his photo and, if he wants them shown, a GitHub handle and email. The card renders a monogram in place of the avatar and carries only a LinkedIn button. The photo could not be added from this session — it arrived as a screenshot in chat, and there is no file on disk to convert into the `240px` avif/webp/jpg variants the other two cards use. The `@handle` line under his name is also absent, because that line is a GitHub username and none is published.

---

- **Timestamp:** 2026-08-09T15:35:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`, `styles.css`, `assets/images/`, `llms-full.txt`, `test/site-invariants.test.js`
- **Intent:** Finish Shashwat Deep's card — email button and avatar — so all three founder cards are identical in shape.
- **Bugs/Gaps Addressed:** Closes the two gaps the previous entry recorded as outstanding. The `llms-full.txt` note claiming no email is published for this co-founder is corrected, since one now is.
- **Context Modifications:**
  - Email button on the card (`deepshashwat@gmail.com`), matching the other two.
  - `assets/images/shashwat.jpeg` (master, 972x972) plus `shashwat-240.jpg` (10.9 KB) and `shashwat-240.webp` (7.6 KB), both inside the 20 KB per-image budget. The master is registered in both `MASTERS` lists in `test/site-invariants.test.js`, so it is exempt from that budget and forbidden from appearing in an `<img>` like the other three masters.
  - `.member-avatar-initial` deleted. It existed only because there was no photo; there is one now, and leaving it would be dead CSS.
- **How the avatar was produced, because it is not the usual path:** the photo arrived as a phone screenshot of a circular profile picture on a black field, not as an image file. The disc's bounding box was cropped out with a canvas in headless Chromium — 144,1054 at 972x972 on the 1260x2800 source — and rescaled to 240. The black corners the square crop leaves are outside the disc and are clipped by `.member-avatar`'s `border-radius: 50%`, so they are never visible.
- **One deviation from the other two cards:** no AVIF variant. Chromium's `canvas.toDataURL` does not encode AVIF and silently returned a 95 KB PNG under an `image/avif` request — shipping that would have been a mislabelled file, four times over the image budget. The `<picture>` therefore offers WebP with a JPEG fallback. Re-encoding a real AVIF needs a tool this environment does not have; the two variants shipped cover every browser.
- **Still absent:** a GitHub handle. That is what the `@handle` line under the other two names is, so Shashwat's card has no handle line. Nothing was invented to fill it.

---

- **Timestamp:** 2026-08-09T15:50:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`
- **Intent:** Add the `@deepshashwat` handle line under Shashwat Deep's name, so all three founder cards carry the same three elements above the bio: avatar, name, handle.
- **Bugs/Gaps Addressed:** Closes the last difference between his card and the other two.
- **Context Modifications:** One `.member-handle` paragraph, and `alternateName` on the `#shashwat` Person node, matching how the other two carry theirs.
- **Note for whoever adds a GitHub link later:** on the other two cards the handle and the GitHub button are the same identity — `@06pratyush` is `github.com/06pratyush`. Here the handle was supplied as display text and no GitHub URL was given, so **no GitHub button was added**. Do not infer `github.com/deepshashwat` from the handle; an invented profile link either 404s or points at a different person.

---

- **Timestamp:** 2026-08-09T16:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`, `llms.txt`, `llms-full.txt`
- **Intent:** Add Shashwat Deep's GitHub link, now that the URL was supplied. His card is now complete: photo, name, handle, bio, and GitHub / LinkedIn / email — the same shape as Pratyush's.
- **Bugs/Gaps Addressed:** Closes the last item the previous entries recorded as outstanding.
- **Context Modifications:** GitHub button first in the link row, matching the order on the other two cards; `https://github.com/shashwat-deep` added to the `#shashwat` node's `sameAs`; both crawler files now carry the GitHub URL, and the note telling crawlers not to infer a handle is replaced.
- **Verified before linking:** the account was confirmed to exist through the GitHub API (`shashwat-deep`, id 77567664) rather than taken on trust. The earlier entries refused to guess `github.com/deepshashwat` from the display handle, and that caution was warranted — **the display handle and the GitHub username are not the same string**. The card shows `@deepshashwat`, as the founders asked, while the account is `shashwat-deep`. On the other two cards those two are identical, so a reader may reasonably assume the handle is the GitHub name here too; `llms-full.txt` states explicitly that both identifiers are the same person, so an answer engine does not treat them as two people.

---

- **Timestamp:** 2026-08-09T16:10:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** `index.html`, `llms-full.txt`
- **Intent:** Change Shashwat Deep's display handle from `@deepshashwat` to `@shashwat-deep`, so it matches his GitHub username the way the other two cards do.
- **Bugs/Gaps Addressed:** Removes the one inconsistency the previous entry flagged. On all three cards the `@handle` line and the GitHub button now name the same identifier, which is what a reader assumes when the other two behave that way.
- **Context Modifications:** The `.member-handle` line and the `alternateName` on the `#shashwat` Person node. The `llms-full.txt` sentence explaining that the display handle and the GitHub username were different is deleted, because they no longer are — leaving it would have been a comment contradicting the thing it describes.

---

- **Timestamp:** 2026-08-09T19:40:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Claude Code) for 06pratyush
- **Target Subsystem:** Repository root — `CLAUDE.md` (new), `CONTEXT.md`, `README.md`
- **Intent:** Adopt the Master Orchestrator Protocol as this repository's mandatory development file, and make the pairing with `CONTEXT.md` structural rather than conventional. Two rules now bind every future session: `CLAUDE.md` governs *how* work is done ([RULE-10]), and `CONTEXT.md` is read before any exploration and updated in the same commit as any change ([RULE-11]). The second is the one that pays: an agent that opens `CONTEXT.md` first does not spend a third of its budget rediscovering the stack, the CSP constraint, the discoverability surface and the open gaps by reading files.
- **Bugs/Gaps Addressed:** None closed. `CONTEXT.md` already existed and was already CI-enforced by `enforce-context-sync.yml`, but nothing told an agent to *read* it first — the gate only checked that it was written to. That asymmetry is what [RULE-11] and §0.2 of `CLAUDE.md` fix. [GAP-06] and [GAP-07] remain open and untouched.
- **Context Modifications:**
  - `CLAUDE.md` is new at the repository root: 16 sections covering delegation triage, the packet format, the verification gate, the review matrix, the correction ladder and the 100-line reading ceiling. Two sections are repo-specific rather than generic. §0.2 is the `CONTEXT.md` mandate — read-first command, what a good entry contains, and a map of which of the six root documents answers which question. §10.0 restates this repository's actual non-negotiables (zero build step, no runtime dependency in the browser, no backend, `script-src 'self'` with no inline script or handler, `spec/manifest.json` as the tool contract, the silent `sitemap.xml`/`sitemap.html`/`llms.txt`/`llms-full.txt` surface, the SEO invariants, the size budgets, `main` as production) with the `npm run lint` / `npm test` / `npm run check` command order before any push. The generic Next.js / FastAPI / Flask / MySQL blocks from the source protocol are kept but demoted to §10.1 "apply when the work is in one", because none of them describes this repo and a delegated packet that quotes them would import a framework that must never ship here.
  - `CONTEXT.md` section 3 gains [RULE-10] and [RULE-11]. The two rules are stated in the manifest itself, not only in the protocol file, so the read-first document carries them.
  - `README.md` repository tree lists `CLAUDE.md` and `CONTEXT.md`, which were both absent from it — the tree named `SECURITY.md` and `RELEASING.md` but not the two files that now govern every change.
  - No page, script, stylesheet, image or dependency was touched. Site runtime behaviour, every per-page budget and the CSP are unchanged; `npm run check` was run to confirm the documentation-only diff breaks nothing.
- **Deliberate omission:** The reading ceiling and the delegation pipeline are documented, not automated — no lint rule or CI job can observe how much an agent read or whether a unit was delegated. Enforcement stays where it already works: `enforce-context-sync.yml` for the record, and `npm run check` for the code. Adding a fake gate for the parts that cannot be measured would be theatre, which §15 of the new file prohibits by name. Also not done: the `.orchestrator/` harness itself is not committed. It is per-machine, depends on a local Ollama install that CI does not have, and §2 of the protocol has the agent create it on first use — committing it would put a dead toolchain in the repository for every contributor without a local model.

---

---

- **Timestamp:** 2026-08-10T00:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for 06pratyush
- **Target Subsystem:** `slm.html`, `pages.css`, `styles.css`
- **Intent:** Add a fourth small model to the dev-gated SLM bench — **Rule-first** (`thl-rule-4b`, Gemma 3 4B Instruct base, 32k context, ~2.6 GB at Q4_K_M, Queued). It applies a rule set the user supplies and cites the clause behind each call, returning uncovered cases as uncovered. Placed third in the grid so the three work-facing postures (documents, tools, rules) sit together and the personal model stays last.
- **Bugs/Gaps Addressed:** `.fade-in-delay-4` was referenced by `media.html` and two cards on `tools.html` but was never defined in `styles.css`, so those cards animated with no stagger. Defining it for the fourth SLM card fixes those three call sites as a side effect — a visual change on two other pages, recorded here because it is invisible in the diff of this page.
- **Context Modifications:** One `.slm-card` block added using only existing classes (`slm-status.queued` already shipped with Personal-first); no new image, script, dependency or origin, so the CSP and the per-page JS budget are untouched. `.slm-grid` moved from three desktop columns to two — with four cards a three-column grid orphans the last one on its own row — which made the `@media (max-width: 1024px)` `.slm-grid` override redundant, so it was removed rather than left as dead CSS. Copy that counted the models was updated in five places: page subtitle, section intro, the Personal-first description ("smallest of the four"), the bench note, and the meta/og/twitter descriptions (new description 149 chars, title unchanged at 44).
- **Deliberate omission:** No discoverability-surface edit. `slm.html` is dev-only and `noindex` (`test/dev-mode.test.js`), so it is absent from `sitemap.xml`, `llms.txt` and `llms-full.txt` by design; no page was added or renamed, so RULE-03 is not triggered. The card claims no download and no benchmark — it is Queued, matching the standing "none of these are downloadable yet" note, so nothing here asserts a model that exists.

---

- **Timestamp:** 2026-08-10T00:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for 06pratyush
- **Target Subsystem:** `blogs.js`, `blogs.html`, `blogs/`, `pages.css`, `blogs/blog.css`, `sitemap.html`, `test/notes-board.test.js`, `test/dev-mode.test.js`
- **Intent:** Split the note board into two kinds of note. A **live note** is finished writing. A **raw note** is the notebook page it came from — questions as they were actually asked, plus a written overview and a reading list — and is held behind dev mode. Ships the first two raw notes: `blogs/dev-tokenisation-questions.html` (seven handwritten questions on tokenisation) and `blogs/dev-llm-systems-questions.html` (eight questions on models, formats, compression, local deployment and adaptation leakage). Each page carries the questions verbatim, a ~600-word overview, and a reference list of ~20 papers grouped by which question it answers.
- **Bugs/Gaps Addressed:** None. New surface. Does not touch [GAP-01] through [GAP-07].
- **Context Modifications:** `NOTES` entries now carry a mandatory `status` of `'live'` or `'dev'`; `noteStatus`, `isRawNote`, `noteVisible`, `visibleNotes` and `isRawGroup` were added to the pure region of `blogs.js` and are unit-tested. `allNotes()` filters by the mode `script.js` wrote onto `<html>`, read via a new `currentMode()`. `noteCardHtml` stamps `data-status="dev"` on a raw card and `noteGroupHtml` stamps it on a group with nothing live in it. Chip row extracted to `noteChipsHtml` to stay under the lint complexity ceiling the change would otherwise have broken. Two `.note-card-raw`/`.note-chip-raw` rules in `pages.css`; `.raw-banner`, `.raw-questions`, `.ref-list` in `blogs/blog.css`. Both new pages are `noindex`, are listed in `sitemap.html` behind `data-status="dev"`, and are registered in `DEV_ONLY_PAGES`. No new script, image, dependency or origin; `blogs.js` is 39.5KB against the 40KB per-page budget.
- **Decision — three gates, not one.** A raw note is held back by the render filter (`allNotes()` drops it in a live session), by the CSS marker on the card (`data-status="dev"`), and by `noindex` on the page it links to. Any one suffices; all three means a mistake in one is not a leak. A test asserts the third gate directly — a raw note whose target page is indexable fails the suite.
- **Decision — `status` has no safe default, so the default is `'dev'`.** This is the opposite of how `navEntryVisible` resolves an unknown nav entry, and deliberately so: an unrecognised nav entry renders and costs a stray link, while an unrecognised note would *publish*. Each defaults to whichever failure is survivable.
- **Decision — raw notes are not pre-rendered into `blogs.html`.** The existing test asserted every note in `NOTES` appears in the hand-written pre-render; it now asserts that of live notes only, and a second test asserts raw notes are *absent*. This is a deliberate change of an invariant, not a weakening of one: the pre-render exists for crawlers that do not run JavaScript, which is exactly the audience a raw note is not for, and `display:none` is not absence — a pre-rendered raw card would put the notebook into the source of an indexable page. Raw cards are built by `blogs.js` at load, in a dev session and nowhere else.
- **Deliberate omission — no `sitemap.xml`, `llms.txt` or `llms-full.txt` entries.** RULE-03 is triggered by adding a page, but both new pages are `noindex`, and `seo-invariants` requires noindex pages to stay out of `sitemap.xml`. The precedent is `slm.html`: dev-only pages appear in `sitemap.html` behind `data-status="dev"` and nowhere else. The crawler surface deliberately does not know these pages exist.
- **Known limitation, stated rather than hidden:** dev mode is not a security boundary — this is already recorded in `script.js` and applies unchanged here. The two raw pages ship to every visitor as static files, and anyone who reads the source or guesses the URL can read them. The gates stop accidental discovery and indexing, not a determined reader. Nothing goes in a raw note that would matter if read.
- **Unverified content, flagged for the author:** the reference lists were written from model knowledge, not from a live lookup — this session has no Ollama and did no web fetch. Titles, authors and venues are stated as confidently as they deserve, but **the arXiv identifiers have not been checked against arXiv**, and one question ("the Security Efficiency Paradox") could not be matched to an established term at all; that overview says so in the page rather than inventing a definition. Both pages carry a line telling the reader to verify every identifier before it is cited anywhere public. This is the single largest risk in the change and it is confined to two `noindex` pages.

---

- **Timestamp:** 2026-08-10T17:15:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for 06pratyush
- **Target Subsystem:** `blogs/dev-tokenisation-questions.html`, `blogs/dev-llm-systems-questions.html`
- **Intent:** Verify the reading lists shipped in the previous entry against arXiv, correct what was wrong, and replace the "unverified" caveat on both pages with a dated statement of what was actually checked.
- **Bugs/Gaps Addressed:** Closes the unverified-content risk recorded in the previous entry. All 45 distinct arXiv identifiers across both pages resolve to the paper named — none was wrong. Seven citation defects were found and fixed: two titles (MANTa is "…for Robust End-to-End Language Modeling", not "…End-to-End Robust…"; the RAG privacy paper carries "(RAG)"; "Membership Inference Attacks *against*", lowercase) and four author lists that named the wrong people (Spectre → Kocher, Genkin, Gruss; Decoding Compressed Trust → Hong, Duan, Zhang; Safety Alignment → Qi, Panda, Lyu; RAG privacy → Zeng, Zhang, He). "Let Me Speak Freely" was reduced to "Tam et al." because only the first author could be confirmed. "Quantifying Memorization" now reads "(2022; ICLR 2023)" rather than implying an ICLR 2022 paper.
- **Context Modifications:** Text only — no script, style, structure, dependency or origin touched, so nothing about the gates, the budgets or the CSP changed.
- **How it was verified, and the limit of that:** arXiv, its API, and every scholarly metadata API (Semantic Scholar, Crossref, OpenAlex) are blocked by this environment's egress proxy; `WebFetch` to arxiv.org returns EGRESS_BLOCKED. Verification was done through `WebSearch` restricted to `arxiv.org`, one query per identifier, matching the returned `[id] Title` listing against the citation. That confirms the id-to-title binding, which is the failure mode that matters. It does **not** confirm full author lists beyond what the search snippets stated, so author strings are now conservative — first authors and "et al." where the rest could not be read directly.
- **Deliberate omission:** The nine non-arXiv references (Newell and Simon, Russell and Norvig, Sutton, AlphaGeometry, Schuster and Nakajima, the GPT-2 paper, Karpathy's tokenizer material, the YAML specification, `llama.cpp`) were not machine-checked. Both pages now name that gap explicitly rather than letting a blanket "verified" imply more than was done.

- **Timestamp:** 2026-08-11T00:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for thehallucinatedlab
- **Target Subsystem:** `data.html` (new), every page carrying a navbar, `pages.css`, `script.js`, `test/dev-mode.test.js`, `README.md`
- **Intent:** Add the data project — a page for the datasets the lab publishes — as a fourth dev-mode section alongside SLM, Certification and Consultancy. The site makes measurable claims about its own tools (a splitter that respects a code fence, an extractor that keeps content and drops chrome) and had nowhere to say what those claims are measured against. `data.html` is that place: four evaluation sets, each carrying its format, its source, its licence and the tool it measures.
- **Bugs/Gaps Addressed:** None. Aggravates [GAP-04] by one page — the navbar is now duplicated across 29 files with a fourth dev entry in each, and a fifth section will cost the same mechanical sweep again.
- **Context Modifications:** New `data.html`, `noindex, nofollow`, canonical `/data.html`, no script of its own beyond the shared `script.js`, no image, no new origin. Registered in `DEV_ONLY_PAGES` in `test/dev-mode.test.js` and given a nav glyph in `NAV_ICONS` in `script.js`. The dev nav group is now `[slm, certification, consultancy, data]` in that order on all 29 pages that have a navbar; the six redirect stubs (`articles`, `certificate`, `converter`, `image-converter`, `livelab`, `utilities`) were skipped because they carry no bar and the drift test skips them too.
- **Decision — co-selectors, not a second card stylesheet.** The dataset card is structurally identical to the SLM bench card (title, status chip, description, spec list). Rather than copy ~100 lines of `.slm-*` rules under new names, `.dataset-grid/-card/-head/-title/-status/-desc/-specs/-note` were added as co-selectors on the existing rules, including both responsive overrides. Nineteen selector lines grew; no rule was duplicated. The alternative — reusing `.slm-*` classes directly on a datasets page — was rejected because the name would then lie about what the card is, and that is exactly the kind of thing that rots unnoticed.
- **Decision — nothing is claimed as available.** No set is published, so the page says so in bold above the fold of the card grid, every status reads "Assembling" or "Planned", and the code block shows the *intended* release layout rather than a command that would 404. This follows the `slm.html` precedent, where four unshipped models are described without implying a download. The three rules panels (provenance before content, no personal data, fetchable without an account) are constraints the lab is binding itself to, not features being advertised.
- **Deliberate omission — no `sitemap.xml`, `sitemap.html` body, `llms.txt` or `llms-full.txt` entry.** RULE-03 fires on adding a page, but the page is `noindex` and `seo-invariants` requires noindex pages to stay out of `sitemap.xml`. The precedent is exact: `slm.html`, `certification.html`, `consultancy.html` and `genai.html` appear in the `sitemap.html` *navbar* behind `data-status="dev"` and in no crawler-facing file. The discoverability surface deliberately does not know this page exists.
- **Deliberate omission — no tools.html gateway card and no `spec/manifest.json` entry.** This is a project page, not a runnable tool; nothing here takes arguments, so a manifest entry would restate a contract that does not exist. Adding a card later is additive and does not disturb the nav.
- **Protocol note — the reader was unavailable.** This is a cloud session with no `ollama`, so §11 delegation did not apply and the work was done directly. The §11.5 ceiling was breached once, deliberately: `slm.html` (188 lines) was read in two ranges to obtain the page skeleton. Justified by [GAP-04] — with no templating layer and no reader, the only source of the head/nav/footer boilerplate is an existing page. Everything else stayed inside the ceiling via `grep -n`, `--stat` and targeted ranges.
- **Verification:** `npm run check` — eslint clean, 377 tests pass, spec in sync. The navbar-drift test and the dev-only-page test both cover the new entry, so a future paste that drops the marker on one page out of twenty-nine fails the build.

- **Timestamp:** 2026-08-11T05:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for thehallucinatedlab
- **Target Subsystem:** `data.html`, `pages.css`, `README.md`
- **Intent:** Empty `data.html` back to a shell at the author's request — the data project is to be built from scratch rather than started from a draft. The dev-mode plumbing added in the previous entry is kept in full; only the page body is removed.
- **Bugs/Gaps Addressed:** None. [GAP-04] remains one page worse than before the previous entry, unchanged by this one — the navbar sweep is not undone, because the page still exists and still needs its entry.
- **Context Modifications:** `data.html` is now head, navbar, hero, footer and an empty `.media-section`, with an HTML comment naming the three things a test will fail on if a future build drops them (the `noindex` meta, the `data-status="dev"` marker on every inbound link, and the dev group order). `pages.css` reverted to its `origin/main` state — the `.dataset-*` co-selectors added in the previous entry are gone. The `README.md` tree line now says empty shell rather than describing content that is no longer there.
- **Decision — the CSS went with the content.** The `.dataset-*` co-selectors styled cards that no longer exist. Leaving them would have shipped selectors matching nothing, which is exactly the dead weight the 2026-08-05 pass removed ~400 lines of. Whoever builds this page picks its own markup, and inheriting a card shape chosen for a draft that was thrown away is a worse starting point than none. Reverting the file wholesale rather than hand-unpicking nineteen selector lines also guarantees no residue.
- **Decision — the previous entry stands.** Section 5 is append-only, so the entry describing the four dataset cards is not edited or removed. It is now a record of work that was reverted, which is the correct state: the reasoning in it (why noindex, why no sitemap entry, why nav-level rather than a tools card) still describes the plumbing that survives, and a reader who finds the page empty needs to know the fuller version existed and was deliberately discarded.
- **Deliberate omission — the gates were not loosened to suit an empty page.** `data.html` keeps its title, description, canonical, og/twitter tags and `noindex`. None of the SEO length or uniqueness tests apply to a noindex page, so this is convention rather than compulsion, but a shell that already carries correct metadata is one less thing to remember at build time.
- **Verification:** `npm run check` — eslint clean, 377 tests pass, spec in sync. Rendered headless to confirm the empty `.media-section` does not collapse the layout: hero and footer sit correctly, no stray gap.

---

- **Timestamp:** 2026-08-14T00:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for thehallucinatedlab
- **Target Subsystem:** `slm.html`, `tools.html`
- **Intent:** Add two postures to the SLM bench — hypothesis-first and reproducible-first — taking the page from four models to six, and bring every count on the page (and its inbound gateway card) back into agreement with what is rendered.
- **Bugs/Gaps Addressed:** Fixes a live inaccuracy on `tools.html`: the SLM gateway card read "Three small language models" while `slm.html` had carried four since it was written. It was wrong before this change and would have been wrong by three after it. No gap opened or closed in section 4.
- **Context Modifications:** Two `.slm-card` blocks appended to the existing `.slm-grid`, following the Document-first card's structure exactly — `.slm-head` with an `<h2 class="slm-title">` and a `.slm-status queued` badge, a `.slm-desc`, and a five-row `<dl class="slm-specs">`. `thl-hypothesis-7b` (Qwen 2.5 7B Instruct, 32k, ~4.7 GB at Q4_K_M, outputs hypothesis/test/falsifier) and `thl-repro-3b` (Qwen 2.5 Coder 3B Instruct, 32k, ~2.0 GB, outputs a pinned re-runnable script). Counts updated in four places on `slm.html`: page subtitle, section intro, the Personal-first card's "smallest of the four", and the `.slm-note` paragraph. `<meta name="description">` rewritten to 144 characters and the og/twitter descriptions to 112; the `<title>` is unchanged and still 46. One line changed on `tools.html`. No new CSS, no new script, no image, no dependency.
- **Decision — no new fade-in delay classes.** `styles.css` defines `.fade-in-delay-1` through `-4` only. The grid is two columns, so cards five and six are a third row and reuse `-1` and `-2`, which puts each new card on the same delay as the card directly above it. Adding `-5`/`-6` would have meant editing a shared stylesheet for two selectors used by one page.
- **Decision — the naming convention was followed, not the request's wording.** The request named these "hypothesis SLM" and "reproducible SLM"; the four existing cards are all `<posture>-first`, so they are titled Hypothesis-first and Reproducible-first. The whole page argues that the posture is the product, and a card that breaks the naming pattern undercuts that.
- **Deliberate omission — the discoverability surface was not touched.** `slm.html` is a dev-only page: it is `noindex, nofollow`, absent from `sitemap.xml`, `llms.txt` and `llms-full.txt`, and listed in `DEV_ONLY_PAGES` in `test/dev-mode.test.js`. RULE-03 governs adding, renaming or removing pages; no page changed here, and publishing new model claims to answer engines while the models are queued and undownloadable would violate RULE-05 in spirit. The right time to write these into `llms-full.txt` is when the page leaves dev mode.
- **Deliberate omission — the `tools.html` teaser still lists three bullets, not six.** The gateway card is a teaser and the three-item `<ul>` is a shape the other cards share; expanding it to six would have unbalanced the gateway grid. Only the count and the noun list in `.gateway-desc` were corrected, so the card no longer states a number that contradicts the page it links to.
- **Protocol note — the reader was unavailable.** Cloud session, no `ollama`, so §11 delegation did not apply and the work was done directly. The §11.5 ceiling held: `slm.html` was read in two targeted ranges (95 lines, then 40) located by `grep -n` rather than opened whole, and every other file was reached via `grep`/`sed` on a known line range.
- **Verification:** `npm run check` — eslint clean, 377 tests pass, spec in sync. The dev-mode test still passes with the page unchanged in status, and the SEO length/uniqueness tests do not apply to a noindex page but the new description is inside the 50–155 band regardless.

---

- **Timestamp:** 2026-08-14T01:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for thehallucinatedlab
- **Target Subsystem:** `slm.html`, `tools.html`
- **Intent:** Add a seventh posture to the SLM bench — context-first, the model that reads what will not fit and returns the line range rather than a paraphrase. Same change shape as the previous entry: one card, then every count on the page brought back into agreement with what renders.
- **Bugs/Gaps Addressed:** None. No gap opened or closed in section 4.
- **Context Modifications:** One `.slm-card` block appended to `.slm-grid`, structured exactly like the six before it. `thl-context-4b` — Gemma 3 4B Instruct, 128k tokens, ~2.6 GB at Q4_K_M, output "Line ranges, not summaries". Counts updated in the same four places on `slm.html` (subtitle, section intro, the Personal-first card, the `.slm-note`) and in `.gateway-desc` on `tools.html`. `<title>` unchanged at 44 characters.
- **Decision — the same base as Rule-first, on purpose.** `thl-context-4b` and `thl-rule-4b` are both Gemma 3 4B Instruct at Q4_K_M, so the footprint row reads identically at ~2.6 GB. That is the honest number rather than an invented differentiator: Gemma 3's 128k window is exactly what the context posture needs, and two cards sharing a base with different tuning and different declared context is a real thing that happens. The differentiator shown is the context row — 128k against Rule-first's 32k — not a fabricated size.
- **Decision — the meta description stopped enumerating.** At six postures the description listed each one; a seventh pushes that past the RULE-04 ceiling of 155 characters. Rather than truncate the list and imply the page has six models, the description now states the count and the principle (146 characters), and the og/twitter pair carries the noun list in short form (122). This is the point at which enumeration stops scaling, and the next card added should extend the count, not the list.
- **Deliberate omission — the odd card is left as an orphan.** `.slm-grid` is `repeat(2, minmax(0, 1fr))`, so a seventh card sits alone in the left column of a fourth row with an empty cell beside it. A `:last-child:nth-child(odd) { grid-column: 1 / -1 }` rule would close the gap, but it means editing a shared stylesheet for a condition that disappears the moment an eighth posture lands, and a full-width card at the end reads as a summary panel rather than as a peer of the six above it. Rendered in both themes: the empty cell reads as whitespace before the full-width `.slm-note`, not as a broken row.
- **Deliberate omission — the `tools.html` teaser bullets are still the original three.** Unchanged from the previous entry's reasoning: only the count and noun list in `.gateway-desc` track the page.
- **Protocol note — the reader was unavailable.** Cloud session, no `ollama`. No file was opened whole; all edits were made against ranges already known from the previous entry's work in this session, per §11.5 rule 8.
- **Verification:** `npm run check` — eslint clean, 377 tests pass, spec in sync. Rendered headless at 1280×1000 in both themes with the fade-in forced: seven cards, geometry byte-identical across themes (card 7 at x40, w588, h365, opacity 1 in both), correct theme tokens, no layout shift.

---

- **Timestamp:** 2026-08-14T02:00:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for thehallucinatedlab
- **Target Subsystem:** `slm.html`, `tools.html`
- **Intent:** Add the eighth and ninth postures to the SLM bench — ML-first and DL-first, the two models pointed at solving a problem with classical machine learning and with deep learning respectively. Same change shape as the two entries above: cards appended, then every count on the page reconciled with what renders.
- **Bugs/Gaps Addressed:** None. No gap opened or closed in section 4.
- **Context Modifications:** Two `.slm-card` blocks appended to `.slm-grid`, structured like the seven before them. `thl-ml-7b` — Qwen 2.5 Coder 7B Instruct, 32k, ~4.7 GB at Q4_K_M, output "Pipeline plus the baseline to beat". `thl-dl-8b` — Llama 3.1 8B Instruct, 32k, ~4.9 GB at Q4_K_M, output "Training loop, with the stop rule". Counts updated in the same four places on `slm.html` and in `.gateway-desc` on `tools.html`. Description now 145 characters, og/twitter 144, `<title>` unchanged at 44.
- **Decision — the two are split by problem class, not by library.** "Solves a problem with ML" and "solves a problem with DL" overlap almost entirely if written loosely, and two cards describing the same job is worse than one. ML-first owns the tabular/prediction path and is accountable for the split, the metric, the leakage checks and the trivial baseline it must beat; DL-first owns architecture, loss, schedule and training loop. The seam is deliberate: DL-first's card states that it will say when a network is the wrong tool, which hands the problem back to ML-first rather than letting both cards claim the same ground.
- **Decision — the honesty clause is per-posture, not boilerplate.** Every card on this page names the failure it refuses: not-in-source, no-schema, uncovered-by-rules, underpowered, unpinned, not-found. ML-first refuses to assert a result it has not measured; DL-first refuses to reach for a network the problem does not need. That is the page's whole argument, and a card without one would read as marketing.
- **Decision — acronyms in the titles.** "ML-first" and "DL-first" break the spelled-out pattern of the other seven titles. Kept anyway: the page already assumes a reader who knows GGUF and Q4_K_M, and "Prediction-first"/"Network-first" would be less clear, not more.
- **Deliberate omission — the orphan card is left alone again.** Nine cards in a two-column grid leaves the ninth alone in the left column, the same condition recorded in the entry above and resolved the same way. Adding the `grid-column` rule now would be the third opportunity to add CSS that an even-numbered tenth posture removes the need for.
- **Deliberate omission — the discoverability surface, again.** `slm.html` is still dev-only and `noindex`; these two models are queued and undownloadable like the seven before them. Unchanged reasoning from the previous two entries — this all lands in `llms-full.txt` when the page leaves dev mode, and that is now nine models' worth of copy owed at that moment, which is worth knowing before someone flips the switch casually.
- **Protocol note — the reader was unavailable.** Cloud session, no `ollama`. No file opened whole; all edits made against ranges already known from earlier work in this session, per §11.5 rule 8. `main` was re-fetched and the branch restarted from it because the pull request carrying the previous two entries had already merged.
- **Verification:** `npm run check` — eslint clean, 377 tests pass, spec in sync. Rendered headless at 1280×1000 in both themes with the fade-in forced: nine cards, identical geometry across themes, no horizontal overflow (`scrollWidth === innerWidth`), both new cards at opacity 1.

---

- **Timestamp:** 2026-08-15T16:35:00Z
- **Trigger Event:** Pull Request
- **Author/Agent:** @06pratyush / Antigravity AI
- **Target Subsystem:** `dictionary/`, `index.html`, `sitemap.html`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, `test/`
- **Intent:** Integrate full aiDictionary_thl reference corpus into the website under `/dictionary/`, add Dictionary tab to top navigation bar immediately after Solutions across all pages, and update all discovery surfaces and test suites.
- **Bugs/Gaps Addressed:** Integrates 39 term pages, static search engine, and dictionary styling into the live site layout.
- **Context Modifications:** Added `dictionary/` directory (index.html, 39 term pages, datasets, assets), updated navigation links across 70+ HTML files, updated `sitemap.html`, `sitemap.xml`, `llms.txt`, and `llms-full.txt`, updated ESLint module config for dictionary JS, and passed 377/377 site invariant tests.


---

- **Timestamp:** 2026-08-15T11:40:00Z
- **Trigger Event:** AI Edit
- **Author/Agent:** Claude (Master Orchestrator) for 06pratyush
- **Target Subsystem:** `dictionary/index.html`, `dictionary/terms/*.html` (40 files)
- **Intent:** Live-site audit of the deployed commit `f81730d`. The dictionary integration shipped a CSP that is weaker than the rest of the site: every one of its 40 pages granted `https://fonts.googleapis.com` in `style-src` and `https://fonts.gstatic.com` in `font-src`. Normalised all 40 to the site baseline so the whole site is once again same-origin only.
- **Bugs/Gaps Addressed:** Closes a live [RULE-01] violation — a third-party origin was permitted on 40 indexable production pages.
- **Context Modifications:** The grant was verifiably **unused**. `dictionary/index.html` loads only `../fonts.css`, `assets/css/tokens.css` and `assets/css/dictionary.css`; there is no `@font-face`, `@import` or `preconnect` naming either Google origin anywhere in the tree, and `BUDGET.thirdPartyOrigins` is already `0`, so no subresource ever resolved there. Removing the two origins therefore changes nothing a visitor sees — it only removes standing permission for an origin the site does not use. The redundant `https://thehallucinatedlab.space` in `img-src` was dropped in the same pass; it is the site's own origin and `'self'` already covers it. All 40 pages carried one byte-identical CSP string, so this was a single mechanical substitution, verified by a residual grep returning nothing.
- **Decision — normalise rather than justify.** The alternative was to keep the grant and document it. Rejected: a CSP that permits an origin no page requests is pure attack surface, and `[GAP-02]` already notes the policy is `<meta>`-delivered and therefore weaker than a header. Widening it further on the newest and most numerous pages is the wrong direction.
- **Verification:** `npm run check` — eslint clean, 377/377 tests pass, spec in sync. Grep confirms zero residual references to either origin under `dictionary/`.
