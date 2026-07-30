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
| **Fonts** | [Outfit](https://fonts.google.com/specimen/Outfit) (headings), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) (body) via Google Fonts |
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
├── styles.css            # Core stylesheet — design tokens, navbar, hero, about
├── pages.css             # Shared component styles for every sub-page
├── script.js             # Particles, navbar, scroll reveals, typing effect
├── tools.js              # Prompt category filter + copy-to-clipboard
├── articles.js           # Article data store, archive search, submission form
├── .nojekyll             # Disables Jekyll on GitHub Pages
├── CNAME                 # Custom domain configuration
├── .gitattributes        # Git config
├── articles/
│   ├── article.css           # Article/artifact reading styles
│   ├── article.js            # Reading progress, TOC, scroll animations
│   ├── ai-orchestration.html # Artifact — RAG pipeline + iteration game
│   ├── complexity.html       # Artifact — complexity explorer
│   └── sample-article.html   # Article — local-first AI
└── assets/
    └── images/
        ├── logo.jpeg         # Lab logo (navbar + favicon)
        ├── pratyush.jpeg     # Team member avatar
        └── divyansh.jpeg     # Team member avatar
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

### SEO
- Open Graph + Twitter Card meta tags on all pages
- Canonical URL
- Semantic HTML5 structure with proper heading hierarchy
- Descriptive `alt` attributes on all images

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
