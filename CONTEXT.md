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
