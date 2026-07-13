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
├── index.html            # Home — hero, about, contact, footer
├── utilities.html        # Utilities page — placeholder while tools are rebuilt
├── interface.html        # AI chat assistant — local Ollama integration
├── styles.css            # Core stylesheet — design tokens, components, responsive
├── pages.css             # Shared styles for utilities and interface pages
├── script.js             # Particles animation, navbar, scroll effects, typing effect
├── .nojekyll             # Disables Jekyll on GitHub Pages
├── CNAME                 # Custom domain configuration
├── .gitattributes        # Git config
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

### Utilities
- Currently a placeholder while the tool platform is being rebuilt

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
| **Home** | Hero with particle canvas, typing animation, about section, contact links |
| **Utilities** | Placeholder page — tools are being rebuilt from scratch |
| **Assistant** | AI chat powered by local Ollama — auto-detects installed model, streaming responses |
| **Navbar** | Fixed top bar — Home, Utilities, Assistant, Contact + mobile hamburger |

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
