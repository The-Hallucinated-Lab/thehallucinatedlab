# Engineering Standards

These are the project's standing constraints. **They do not change when
a feature does.** Anything built here — a page, a tool, a dependency, a
refactor — has to satisfy them, and most of them fail CI if it doesn't.

The distinction that matters:

- **Invariants** are enforced by a test. You cannot regress one without
  a red build. Do not weaken the test to make a change pass.
- **Judgment rules** cannot be tested. They are here so a reviewer has
  something specific to point at.

---

## 1. Invariants (enforced — a red build means you broke one)

### Discoverability — Google and LLM crawlers

`test/seo-invariants.test.js`

| Rule | Why it exists |
|---|---|
| Every indexable page has title, description, canonical, `og:url`, `og:title`, `og:image` | A page missing these is invisible or renders as a blank card when shared |
| `canonical` matches the file's own path, and `og:url` agrees with it | A wrong canonical tells Google to rank a different page |
| Titles ≤ 70 chars, descriptions 50–165 chars | Past that, Google truncates and writes its own |
| No two pages share a title or description | Duplicate-content signal; the crawler can't tell which to rank |
| `og:image` resolves to a real file | A 404 social image is a blank share card |
| `sitemap.xml` lists **exactly** the indexable pages — no more, no fewer | Both directions rot: new pages go unlisted, renamed ones 404 |
| Redirect stubs are `noindex` **and** absent from the sitemap | Otherwise they compete with the page they point at |
| `robots.txt` advertises the sitemap and has no blanket `Disallow: /` | One stray line delists the entire site |
| `llms.txt` and `llms-full.txt` link only to real pages **and** cover every indexable page | These are the AI-crawler equivalent of the sitemap |
| Every JSON-LD block parses and has `@context` | Malformed structured data is silently dropped |

**This surface rots more quietly than anything else in the repo.**
Nothing on the site links to `sitemap.xml` or `llms.txt`, so a rename
breaks them with no visible symptom. It has already happened twice:
`articles.html` → `blogs.html`, and `llms-full.txt` went on telling AI
crawlers the Assistant needed a local Ollama install for a full release
after that stopped being true.

> **When you add or rename a page, update `sitemap.xml`, `llms.txt` and
> `llms-full.txt` in the same commit.** The tests will tell you, but
> knowing this saves a round trip.

### Security

`test/site-invariants.test.js`

| Rule | Why |
|---|---|
| No inline `<script>` on any page | CSP is `script-src 'self'`; inline script does not error, it silently does not run |
| No inline event handlers (`onclick=`, …) | Same — a print button sat dead for a whole release |
| No `script-src` with `unsafe-inline` / `unsafe-eval` | Widening the CSP makes the whole policy decorative |
| No third-party origin in any subresource | Zero third parties is why `default-src 'self'` is possible |
| No page references `node_modules` | Dev tooling must never reach a page |

### Performance

`test/site-invariants.test.js` — budget mirrors the README table.

| Rule | Limit |
|---|---|
| Requests, first load | ≤ 10 |
| Homepage transferred | ≤ 150 KB |
| Any shipped image | ≤ 20 KB |
| Any page script | ≤ 40 KB |
| Third-party origins | 0 |
| Every `<img>` has `width` and `height` | prevents layout shift |
| No `<img>` points at a master image | a 1024px source in a 36px box costs ~4 MB of decoded RAM |

### Correctness

| Rule | Enforced by |
|---|---|
| Every `.js` file parses | CI `node --check` |
| Lint clean | `npm run lint` |
| The packaged tool spec matches `spec/manifest.json` | `scripts/sync-spec.js --check` |
| Python lints and passes | `ruff check python/`, `pytest python/` |
| No credential patterns committed | CI secret scan |
| No NUL bytes in source | `site-invariants` |

---

## 2. Judgment rules

Not testable. Enforced by review.

**Errors**
- Never an empty `catch`. If you are absorbing something deliberately,
  say what and why in the block — that also satisfies the linter.
- Never render a raw exception message to a user. Classify it first.
- Every outbound network call gets a timeout. A call with no deadline
  cannot fail; it can only hang.
- A failure must leave the UI in a state the user can act on. Not a
  spinner, not silence.

**Lifecycle**
- Anything that observes must also stop. Observers `unobserve` when they
  fire; timers get cleared; animation stops when the tab is hidden.
- Decoration checks `shouldAnimate()` first — reduced-motion, Save-Data,
  2G, ≤2 GB devices.
- Feature init is isolated. One throwing feature must not take the
  navbar down with it.

**Data**
- Validate at the boundary, report every problem at once, and normalise
  before storing.
- Anything read back from `localStorage` is untrusted.
- Timestamps are full ISO 8601 with offset. Never `.split('T')[0]`.
- Bounds live in `spec/manifest.json` and nowhere else.

**Comments**
- Explain *why*, not *what*. The diff already says what.
- A comment that contradicts the code is worse than no comment. When
  behaviour changes, the header comment changes in the same commit.

---

## 3. Deliberately not done

Recorded so nobody re-proposes them without new information.

| Rejected | Reason |
|---|---|
| Sentry / APM / RUM | Every one adds a third-party origin that phones home. Breaks the zero-third-party invariant and the site's stated privacy premise. |
| TypeScript migration | `checkJs` reported 108 errors; 105 were `getElementById` DOM casts. Silencing them needs ~100 JSDoc annotations that catch nothing. Kept as an occasional audit, not a gate. |
| Prettier | The lint config is deliberately strict on correctness and silent on style. Adding a formatter re-opens the argument. |
| Docker | Static files on GitHub Pages. Nothing to containerise. |
| ESLint `no-var` / `no-implicit-globals` | 199 findings, zero bugs. Both argue with the architecture rather than finding defects in it. Reasoning is in `eslint.config.js`. |
| `content-visibility: auto` | Measured: off-screen sections collapse to a placeholder, reporting the homepage as 3481px against a real 4205px and putting anchors on guessed positions. |
| A backend for the converter | `canvas.toBlob` removed an upload endpoint, a size limit, a virus scan, temp storage, a cleanup job and a privacy policy in one decision. |

---

## 4. Recipes

Following these satisfies the invariants by construction.

### Adding a page

1. Copy the `<head>` of an existing page; update `title`, `description`
   (50–165 chars, unique), `canonical`, `og:url`, `og:title`.
2. Keep the CSP and `referrer` meta tags exactly as they are.
3. Add it to `sitemap.xml`.
4. Add a line to `llms.txt` and a `## Page:` section to `llms-full.txt`.
5. `npm test` — the SEO invariants will name anything you missed.

### Renaming a page

Everything above, **plus** leave a redirect stub at the old path:
`noindex`, a `redirect-to` meta, and `redirect.js`. Do not add the stub
to the sitemap.

### Adding a tool

1. Define it in `spec/manifest.json` — name, params, types, bounds,
   defaults. This is the contract.
2. `npm run spec:sync` so the Python package gets the same copy.
3. Implement in the browser and in `python/`. Neither restates a bound.

### Adding a dependency

Assume the answer is no. If it must happen:

- **Runtime, for the site: not permitted.** It would introduce a
  third-party origin and break the CSP.
- **Dev tooling:** exact version, lockfile committed, `devDependencies`
  only, `npm ci --ignore-scripts` in CI.
- **Python:** bound the range (`>=x,<y`). An unbounded `>=` lets a new
  lint rule turn CI red on code nobody touched — that has happened.

---

## 5. Working with an AI agent

Most of this codebase was written with one. It is a fast junior, not a
peer. It produces code that runs and is subtly wrong.

Real examples from this repo:

- Escaped newlines *before* matching fenced code blocks, so every code
  block the model produced rendered as literal backticks. Reviewed fine.
- Rebuilt an `IntersectionObserver` on every render and never
  disconnected it — a detached DOM tree per search keystroke.
- `if (!name || !title || !body) return;` as an entire form validator: a
  silent bail indistinguishable from a broken page.
- A `fetch` with no timeout on the path that mattered.
- A stale header comment claiming the file talked to Ollama, four lines
  above the comment explaining there is deliberately no model.

**Three questions catch most of it.** What happens when the input is
empty? When the network never answers? When it gets called twice?

Read every line before committing it. When the agent proposes a new
dependency, a new third-party origin, or weakening a test to make
something pass — the answer is no.
