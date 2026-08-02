<div align="center">

# The Hallucinated Lab

### *Your Machine. Your Power. No Limits.*

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fthehallucinatedlab.space&style=for-the-badge&label=LIVE&color=c9a84c)](https://thehallucinatedlab.space)
[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-181717?style=for-the-badge&logo=github)](https://pages.github.com/)
[![License](https://img.shields.io/badge/License-MIT-e8d48b?style=for-the-badge)](LICENSE)

We build tools that give you **unrestricted access** to cutting-edge technology — running **entirely on your machine**.

No cloud lock-ins. No paywalls. No ceilings. Your data stays yours.

---

[**Visit the Website →**](https://thehallucinatedlab.space)

</div>

---

## 🧠 Our Ideology

We believe that every powerful tool — from AI models and video generators to quantum simulators and code analyzers — should run right on your own hardware, with zero restrictions.

| Principle | What It Means |
|---|---|
| **Unrestricted Access** | Every tool we build gives you complete, unlimited access to cutting-edge technology — running entirely on your local machine. |
| **Privacy by Default** | When everything runs locally, your data never leaves your hands. No telemetry, no cloud dependency — full sovereignty over your workflow. |
| **No Paywalls, No Ceilings** | If it can run on your hardware, you should have unrestricted access to use it — always. |

---

## 🏗️ Tech Stack

This is a **zero-dependency static website** — no frameworks, no build tools, no package managers.

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
├── media.html            # Media — gateway to Articles / Artifacts / Notebooks
├── articles.html         # Articles — Featured, Archive, Community Spotlight
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
├── articles.js           # Article data store, archive search, submission form
├── interface.js          # Assistant chat engine (Ollama)
├── solutions.js          # ScoobyBench screenshot tab switcher
├── redirect.js           # Shared redirect for the renamed-page stubs
├── SECURITY.md           # Disclosure policy + known header limitations
├── robots.txt            # Crawl permissions — AI/LLM agents explicitly allowed
├── sitemap.xml           # 13 canonical URLs for search engines
├── llms.txt              # Concise Markdown site summary for LLM crawlers
├── llms-full.txt         # Full machine-readable site directory
├── .nojekyll             # Disables Jekyll on GitHub Pages
├── CNAME                 # Custom domain configuration
├── .gitattributes        # Git config
├── articles/
│   ├── article.css           # Article/artifact reading styles
│   ├── article.js            # Reading progress, TOC, scroll animations
│   ├── ai-orchestration.html # Artifact — RAG pipeline + iteration game
│   ├── ai-orchestration.js   # Its interactive figures
│   ├── complexity.html       # Artifact — complexity explorer
│   ├── complexity.js         # Its interactive figures
│   └── sample-article.html   # Article — local-first AI
└── assets/
    ├── fonts/                # Variable WOFF2, latin + latin-ext subsets
    ├── vendor/               # GSAP 3.12.2 (self-hosted, was cdnjs)
    └── images/
        ├── logo.jpeg         # 1024px master — social card only
        ├── logo-72.{avif,webp,jpg}      # Navbar, 36px @2x
        ├── favicon-32.png / favicon-180.png
        ├── pratyush.jpeg / divyansh.jpeg  # Masters for the variants below
        ├── pratyush-240.{avif,webp,jpg}   # About-page avatar, 120px @2x
        ├── pratyush-80.{avif,webp,jpg}    # Article byline, 40px @2x
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
- **Dark theme** with a gold accent palette (`#c9a84c` primary)
- **CSS custom properties** for consistent theming across all components
- **Two font families** — Outfit (headings), JetBrains Mono (body/code)
- **Smooth transitions** using a custom cubic-bezier easing curve

### Assistant
- **Local-only chat** — talks to Ollama running on your machine; no API keys, no cloud, no data leaves your device
- **Auto-detects installed model** (recommended: `gemma4:e4b`); falls back through `gemma4:e2b → gemma3:4b → gemma2:2b → llama3.2:*` and finally any installed model
- **Streaming responses** rendered token-by-token, with a setup panel that surfaces install/CORS instructions when Ollama isn't reachable

### Tools
- **Prompt library** — eight production-ready prompts with category filters and one-click copy
- **LoRA adapters** — fine-tuned adapters for locally running models, with Ollama and PEFT usage guides
- **THL Library** — pip-installable packages and embeddable engines (NexusLink Engine)

### Media
- **Articles** — featured picks, a searchable archive, and a community spotlight with a submission form (stored in `localStorage`)
- **Artifacts** — interactive explainers you operate rather than read
- **Notebooks** — runnable research, landing soon

### SEO & AI discoverability
- **JSON-LD on every page** — an `Organization` / `Person` / `WebSite` identity graph on the home page, with `BreadcrumbList`, `CollectionPage`, `SoftwareApplication`, `WebApplication`, `ProfessionalService`, `Course`, and `Article` / `LearningResource` on the pages they describe
- **`llms.txt` and `llms-full.txt`** — Markdown summaries written for LLM crawlers, including an accuracy section stating what is *not* yet available so answer engines don't overstate it
- **`robots.txt`** explicitly allowing AI agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended and others) plus an XML sitemap
- **Pre-rendered article listings** — the Featured and Archive grids ship as static HTML so crawlers that don't execute JavaScript still see every article; `articles.js` re-renders the same markup and takes over the filtering
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
| JavaScript, per page | **≤ 40 KB** uncompressed | Article pages are the exception: GSAP is ~115 KB on top. |
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

---

## 🧩 Page Sections

| Page | Description |
|---|---|
| **Home** | Hero with particle canvas and typing animation, an "Explore the Lab" guide to every tab, services & certification band, and the team/about section at the bottom |
| **Tools** | Prompts, LoRA adapters, and the THL Library — everything meant to leave with you |
| **Assistant** | AI chat powered by local Ollama — auto-detects installed model, streaming responses |
| **Solutions** | Shipped products, led by ScoobyBench (AI hardware benchmarking) |
| **Media** | Gateway to Articles, Artifacts, and Notebooks |
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
