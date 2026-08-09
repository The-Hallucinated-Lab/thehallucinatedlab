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
