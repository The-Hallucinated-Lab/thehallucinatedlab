<div align="center">

# The Hallucinated Lab

### *Your Machine. Your Power. No Limits.*

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fthehallucinatedlab.space&style=for-the-badge&label=LIVE&color=c9a84c)](https://thehallucinatedlab.space)
[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-181717?style=for-the-badge&logo=github)](https://pages.github.com/)
[![License](https://img.shields.io/badge/License-MIT-e8d48b?style=for-the-badge)](LICENSE)

**Open-source** AI tools that run **entirely on your machine** — free, and without any rate limits.

No cloud lock-ins. No paywalls. No ceilings. Your data stays yours.

---

[**Visit the Website →**](https://thehallucinatedlab.space)

</div>

---

## 🧠 Our Ideology

We believe that every powerful tool — from AI models and video generators to quantum simulators and code analyzers — should run right on your own hardware, with zero restrictions.

| Principle | What It Means |
|---|---|
| **Open Source, Always** | Every tool we build is open source and runs entirely on your local machine. What you can run is bounded by your hardware, not by a plan. |
| **Privacy by Default** | When everything runs locally, your data never leaves your hands. No telemetry, no cloud dependency — full sovereignty over your workflow. |
| **No Paywalls, No Ceilings** | If it can run on your hardware, you should have unrestricted access to use it — always. |

---

## 🏗️ Tech Stack

The **site** is zero-dependency — no frameworks, no build step, no bundler. Nothing in
`node_modules` is served, bundled, or referenced by any page. ESLint is dev tooling only.

| Layer | Technology |
|---|---|
| **Structure** | HTML5 with semantic elements |
| **Styling** | Vanilla CSS with CSS custom properties (design tokens) |
| **Interactivity** | Vanilla JavaScript (ES6+) |
| **Fonts** | [Outfit](https://fonts.google.com/specimen/Outfit) (headings), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) (body) — self-hosted variable WOFF2, Latin subsets |
| **Hosting** | GitHub Pages |
| **Domain** | [thehallucinatedlab.space](https://thehallucinatedlab.space) (custom domain via CNAME) |

---

## 📁 Project Structure

```
thehallucinatedlab/
├── index.html            # Home — hero, "Explore the Lab" tab guide, services, about
├── tools.html            # Tools — Prompts, LoRA Adapters, THL Library
├── interface.html        # Assistant — local Ollama chat integration
├── solutions.html        # Solutions — shipped products (ScoobyBench)
├── media.html            # Media — gateway to Blogs / Artifacts / Notebooks
├── blogs.html         # Blogs — Featured, Archive, Community Spotlight
├── artifacts.html        # Artifacts — interactive, playable explainers
├── certification.html    # Certification — course tracks and the certificate
├── consultancy.html      # Consultancy — individual & business engagements
├── library.html          # THL Library — full package shelf (linked from Tools)
├── livelab.html          # Redirect → tools.html (old LiveLab URL)
├── utilities.html        # Redirect → library.html (old Utilities URL)
├── certificate.html      # Redirect → certification.html (old URL)
├── 404.html              # Custom not-found page (served by GitHub Pages)
├── styles.css            # Core stylesheet — design tokens, navbar, hero, about
├── pages.css             # Shared component styles for every sub-page
├── fonts.css             # Self-hosted @font-face + metric-matched fallbacks
├── script.js             # Particles, navbar, scroll reveals, typing effect
├── tools.js              # Prompt category filter + copy-to-clipboard
├── blogs.js           # Blog data store, archive search, submission form
├── interface.js          # Assistant chat engine (intent parser + Ollama)
├── convert.html  # Convert — the first THL tool
├── eda.html              # Exploratory data analysis — the command-line profiler
├── convert.js    # Its drop zone, controls, and result panel
├── toolkit.js            # Shared tool runtime + argument-table renderer
├── nlp.js                # Intent parser (classification + slot filling)
├── solutions.js          # ScoobyBench screenshot tab switcher
├── redirect.js           # Shared redirect for the renamed-page stubs
├── SECURITY.md           # Disclosure policy + known header limitations
├── robots.txt            # Crawl permissions — AI/LLM agents explicitly allowed
├── sitemap.xml           # 13 canonical URLs for search engines
├── llms.txt              # Concise Markdown site summary for LLM crawlers
├── llms-full.txt         # Full machine-readable site directory
├── RELEASING.md          # How the pip package gets published
├── LICENSE               # MIT
├── spec/
│   ├── manifest.json         # THE tool spec — every consumer reads this
│   └── nlp-fixtures.json     # Shared parser cases, run by both test suites
├── scripts/
│   └── sync-spec.js          # Copies the spec into the Python package
├── python/                   # The `thehallucinatedlab` pip package
│   ├── pyproject.toml
│   ├── README.md             # PyPI long description
│   ├── thehallucinatedlab/
│   │   ├── registry.py           # Reads the manifest, validates arguments
│   │   ├── nlp/__init__.py       # Python port of nlp.js
│   │   ├── tools/convert.py# Pillow implementation
│   │   ├── nexuslink.py          # Lazy door onto the NexusLink binding
│   │   ├── cli.py                # The `thl` command
│   │   └── data/manifest.json    # Synced copy of spec/manifest.json
│   └── tests/                # pytest
├── .nojekyll             # Disables Jekyll on GitHub Pages
├── CNAME                 # Custom domain configuration
├── .gitattributes        # Git config
├── blogs/
│   ├── blog.css           # Blog/artifact reading styles
│   ├── blog.js            # Reading progress, TOC, scroll animations
│   ├── ai-orchestration.html # Artifact — RAG pipeline + iteration game
│   ├── ai-orchestration.js   # Its interactive figures
│   ├── complexity.html       # Artifact — complexity explorer
│   ├── complexity.js         # Its interactive figures
│   └── sample-blog.html   # Blog — local-first AI
└── assets/
    ├── fonts/                # Variable WOFF2, latin + latin-ext subsets
    ├── vendor/               # GSAP 3.12.2 (self-hosted, was cdnjs)
    └── images/
        ├── logo.jpeg         # 1024px master — social card only
        ├── logo-72.{avif,webp,jpg}      # Navbar, 36px @2x
        ├── favicon-32.png / favicon-180.png
        ├── pratyush.jpeg / divyansh.jpeg  # Masters for the variants below
        ├── pratyush-240.{avif,webp,jpg}   # About-page avatar, 120px @2x
        ├── pratyush-80.{avif,webp,jpg}    # Blog byline, 40px @2x
        └── divyansh-240.{avif,webp,jpg}
```

---

## ✨ Features

### Visual & UX
- **Particle canvas** — animated gold particles with dynamic interconnecting lines in the hero background
- **Typing effect** — cycling ideology phrases with typewriter animation
- **Scroll-triggered fade-ins** — elements animate into view using `IntersectionObserver`
- **Glassmorphic navbar** — backdrop-blur with scroll-aware styling
- **Responsive design** — mobile hamburger menu, stacked layouts on small screens

### Design System
- **Dark theme** with a gold accent palette (`#c9a84c` primary), and a warm sand light theme (`#e8dfcb` page, `#6b5410` accent) chosen before first paint by `theme.js`
- **CSS custom properties** for consistent theming across all components
- **Two font families** — Outfit (headings), JetBrains Mono (body/code)
- **Smooth transitions** using a custom cubic-bezier easing curve

### Assistant
- **Tools without a model** — an intent parser reads every message first; "convert this to png" runs in the page and returns a file, with nothing installed
- **Asks rather than guesses** — a request missing a required argument gets one question, and the answer is merged into the pending call
- **Local-only chat** — anything the parser doesn't recognise goes to Ollama running on your machine; no API keys, no cloud, no data leaves your device
- **Auto-detects installed model** (recommended: `gemma4:e4b`); falls back through `gemma4:e2b → gemma3:4b → gemma2:2b → llama3.2:*` and finally any installed model
- **Streaming responses** rendered token-by-token, with a setup panel that surfaces install/CORS instructions when Ollama isn't reachable

### Tools
- **Convert** — PNG / JPEG / WebP / AVIF conversion on a canvas; nothing uploaded, works offline, and it probes the browser's real encoder support instead of handing back a mislabelled file
- **Exploratory data analysis** — `thl pipeline eda sales.csv` profiles a data file and returns a Markdown report, the figures, a replayable recipe, and a runnable `analysis.py` that reproduces the report exactly. Every column gets an inferred type *and* a confidence, and sampling is never silent
- **One spec, four consumers** — `spec/manifest.json` drives the convert UI, the argument tables, the parser's vocabulary and the Python package, so the docs cannot describe arguments the code rejects
- **Tools declare where they run** — the `runtimes` field is respected, so the Assistant names the command for a Python-only tool rather than offering to run something it cannot
- **Prompt library** — eight production-ready prompts with category filters and one-click copy
- **LoRA adapters** — fine-tuned adapters for locally running models, with Ollama and PEFT usage guides
- **THL Library** — pip-installable packages and embeddable engines (NexusLink Engine)

### Media
- **Blogs** — featured picks, a searchable archive, and a community spotlight with a submission form (stored in `localStorage`)
- **Artifacts** — interactive explainers you operate rather than read
- **Notebooks** — runnable research, landing soon

### SEO & AI discoverability
- **JSON-LD on every page** — an `Organization` / `Person` / `WebSite` identity graph on the home page, with `BreadcrumbList`, `CollectionPage`, `SoftwareApplication`, `WebApplication`, `ProfessionalService`, `Course`, and `Blog` / `LearningResource` on the pages they describe
- **`llms.txt` and `llms-full.txt`** — Markdown summaries written for LLM crawlers, including an accuracy section stating what is *not* yet available so answer engines don't overstate it
- **`robots.txt`** explicitly allowing AI agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended and others) plus an XML sitemap
- **Pre-rendered article listings** — the Featured and Archive grids ship as static HTML so crawlers that don't execute JavaScript still see every article; `blogs.js` re-renders the same markup and takes over the filtering
- Open Graph + Twitter Card meta with images, canonical URLs, and `preconnect` hints for the font origins
- One `<h1>` per page and no skipped heading levels
- Descriptive `alt` attributes and explicit `width`/`height` on all images (no layout shift)

---

## 🚀 Getting Started

### View Locally

No build step required. Just open the file:

```bash
# Clone the repo
git clone https://github.com/06pratyush/thehallucinatedlab.git
cd thehallucinatedlab

# Open in your browser
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

Or use any local server:

```bash
# Python
python -m http.server 8000

# Node.js (npx, no install)
npx -y serve .
```

> **The tool pages need a server, not `file://`.** `convert.html` and the
> Assistant fetch `spec/manifest.json`, which the browser blocks over `file://`.
> Every other page opens fine either way.

### Working on the pip package

The site stays dependency-free; `python/` does not, because encoding images is not
something to hand-roll.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e "python[dev]"

pytest python/ -q
ruff check python/
```

Editing `spec/manifest.json` means re-syncing the copy the wheel carries:

```bash
node scripts/sync-spec.js
```

Publishing is documented in [RELEASING.md](RELEASING.md).

### Deploy

The site is deployed automatically via **GitHub Pages** from the `main` branch. Any push to `main` triggers a deployment to [thehallucinatedlab.space](https://thehallucinatedlab.space).

---

## 📊 Performance Budget

There is no bundler here to enforce this, so it lives in the README
instead. **If a change pushes a page over these numbers, that is the
change's problem to justify — not a number to raise.**

| Budget | Limit | Why |
|---|---|---|
| Requests, first load | **≤ 10** | Every page today is 8 or fewer. |
| Transferred bytes, first load | **≤ 150 KB** | Homepage is well under this after compression. |
| JavaScript, per page | **≤ 40 KB** uncompressed | Blog pages are the exception: GSAP is ~115 KB on top. |
| Third-party origins | **0** | Fonts and GSAP are self-hosted. Adding an origin needs a real reason. |
| Any single image | **≤ 20 KB** | Serve a variant sized for its container, never the master. |
| DOM nodes, per page | **≤ 1,500** | Homepage sits around 250. |
| Fonts | **2 families, variable, Latin only** | Two files cover every weight the CSS uses. |

Rules of thumb behind those numbers:

- **Never point an `<img>` at a master image.** `logo.jpeg` is 1024×1024
  and exists only for the social card. The navbar uses `logo-72.*`.
  A 1024px image in a 36px box costs ~4 MB of decoded RAM to display
  3 KB worth of pixels.
- **Every `<img>` needs `width` and `height`** so nothing shifts while
  it loads.
- **No inline `<script>`.** The CSP on every page is `script-src 'self'`
  with no `unsafe-inline`; an inline block will silently not run. Put it
  in a `.js` file and load it with `defer`.
- **Decoration checks `shouldAnimate()` first.** `script.js` skips the
  particle canvas and the typing loop on reduced-motion, Save-Data,
  2G, and ≤2 GB devices. New animation should do the same.
- **Anything that observes or subscribes must also stop.** Observers get
  `unobserve`d on reveal; the particle loop stops when the tab is hidden
  or the hero scrolls away.

### Regenerating assets

Image variants (needs Pillow):

```bash
python -c "
from PIL import Image
im = Image.open('assets/images/logo.jpeg').convert('RGB').resize((72,72), Image.LANCZOS)
im.save('assets/images/logo-72.webp', quality=80, method=6)
im.save('assets/images/logo-72.avif', quality=58)
im.save('assets/images/logo-72.jpg', quality=80, optimize=True)
"
```

Fonts: request the variable ranges from Google Fonts with a browser
User-Agent, then save the `latin` and `latin-ext` WOFF2 files into
`assets/fonts/` and update `fonts.css`. The URL that produced the
current set:

```bash
curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Outfit:wght@400..800&family=JetBrains+Mono:wght@400..600&display=swap"
```

The `size-adjust` / `ascent-override` numbers on the fallback faces in
`fonts.css` were measured in-browser against Arial and Courier New. If
you change a font, re-measure them — stale values reintroduce the
layout shift they exist to prevent.

Security policy and the headers GitHub Pages cannot set are documented
in [SECURITY.md](SECURITY.md).

The project's standing engineering constraints — what CI enforces, what
review enforces, and what we have deliberately rejected — are in
[STANDARDS.md](STANDARDS.md). Start there before adding a page, a tool,
or a dependency.

---

## 🧪 Tests

The **shipped site** has no dependencies and no build step. The test
suite keeps it that way — it uses `node:test` and `node:assert`, both
built into Node, so no test framework is installed.

There is a `package.json`, but it holds **devDependencies only** (ESLint
and its globals list). Nothing it installs reaches a page.
`test/site-invariants.test.js` asserts that no page references
`node_modules`, so the boundary is enforced rather than remembered.

```bash
npm install        # dev tooling only
npm run check      # lint + tests + spec sync
npm test           # tests alone — needs no install
```

Browser scripts are plain `<script>` files, not modules, so each one
marks the block that is genuinely free of DOM, storage and network
access with sentinel comments:

```js
/* @pure-start */
function escapeHtml(str) { ... }
/* @pure-end */
```

`test/helpers/load-pure.js` reads that block and evaluates it under
Node. If someone reaches for `document` inside the markers, the tests
fail with a `ReferenceError` — which is the point.

What is covered:

| File | Covers |
|---|---|
| `test/markdown.test.js` | `formatMarkdown()` — the only place text we did not author reaches `innerHTML`. Rendering, plus a payload battery asserting no input can emit a tag outside `<pre> <code> <strong> <em> <br>`. |
| `test/submission.test.js` | The community form validator: bounds, normalization, the category allowlist, and coercion of whatever is already in `localStorage`. |
| `test/site-invariants.test.js` | Properties of the site itself — no inline `<script>`, no third-party origin, no widened CSP, no `<img>` at a master image, no broken asset reference, and the budget above. |
| `test/nlp.test.js` | The intent parser, driven by `spec/nlp-fixtures.json`. |
| `test/toolkit.test.js` | Argument validation against the manifest, output filenames, and the argument-table model. |
| `test/manifest.test.js` | That the spec and the copy inside the wheel are byte-identical, that every tool declares what its consumers read, and that the examples shown on the site really parse the way they claim. |

The intent parser exists twice — `nlp.js` and `thehallucinatedlab.nlp` — because the
website and the package both need it and neither can import the other. That is a real
drift risk, so both suites run the same `spec/nlp-fixtures.json`. Teach one parser a
phrasing without the other and the build goes red.

```bash
pytest python/ -q      # 70 tests, including the shared parser fixtures
ruff check python/
```

That last file is the one that matters most for a site with no build
step. A future inline `<script>` will not throw — the CSP silently
blocks it and the feature just stops working. The test catches it
before it ships.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the Node suite
plus a `node --check` over every script, the Python suite on 3.10 and 3.13,
and a credential tripwire, on pull requests and pushes to `main`.
[`release.yml`](.github/workflows/release.yml) publishes the pip package on a
`v*` tag using PyPI Trusted Publishing, so no API token is stored here.
Actions are pinned to commit SHAs rather than mutable tags.

---

## 🧩 Page Sections

| Page | Description |
|---|---|
| **Home** | Hero with particle canvas and typing animation, an "Explore the Lab" guide to every tab, services & certification band, and the team/about section at the bottom |
| **Tools** | Prompts, LoRA adapters, and the THL Library — everything meant to leave with you |
| **Assistant** | AI chat powered by local Ollama — auto-detects installed model, streaming responses |
| **Solutions** | Shipped products, led by ScoobyBench (AI hardware benchmarking) |
| **Media** | Gateway to Blogs, Artifacts, and Notebooks |
| **Certification** | Six project-graded course tracks and what the certificate actually attests to |
| **Consultancy** | Engagements for individuals and businesses, plus how we scope and hand over work |
| **Navbar** | Fixed top bar — Home, Tools, Assistant, Solutions, Media, Certification, Consultancy + mobile hamburger |

---

## 👥 The Team

| | Name | Handle | Focus |
|---|---|---|---|
| 🧑‍💻 | **Pratyush** | [@06pratyush](https://github.com/06pratyush) | AI, Machine Learning, Data Science |
| 🧑‍💻 | **Divyansh Tripathi** | [@TheQMLGuy](https://github.com/TheQMLGuy) | Quantum Computing, ML, Developer Experience |

---

## 📬 Contact

| Channel | Link |
|---|---|
| ✉️ Email | [thehallucinatedlab@gmail.com](mailto:thehallucinatedlab@gmail.com) |
| 🐙 GitHub (Pratyush) | [github.com/06pratyush](https://github.com/06pratyush) |
| 🐙 GitHub (Divyansh) | [github.com/TheQMLGuy](https://github.com/TheQMLGuy) |
| 💼 LinkedIn | [linkedin.com/in/pratyush-p-1226b532b](https://www.linkedin.com/in/pratyush-p-1226b532b) |

---

<div align="center">

*Built with curiosity and caffeine.*

© 2026 [The Hallucinated Lab](https://thehallucinatedlab.space)

</div>
