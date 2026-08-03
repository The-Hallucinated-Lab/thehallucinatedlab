# Site redesign: inline flyout nav, dev/live split, local identity

Date: 2026-08-03
Status: approved design, not yet implemented

## Problem

Three problems, one root cause.

1. **The site advertises things that don't work.** Several sections present finished-looking UI for
   features that are mockups. Visitors can't tell what's real.
2. **Sections are cluttered.** `media.html` stacks Articles and Visualiser onto one scrolling page.
   Utilities will hit the same wall as tools are added.
3. **The navbar is copy-pasted into five HTML files.** `index`, `utilities`, `interface`, `media`,
   and `solutions` each carry their own `<ul class="nav-links">`. Any nav change is a five-file edit,
   and the copies will drift.

The root cause is that there is no single description of what sections exist, what lives under them,
and which of them are real. Every consumer of that information re-derives it by hand.

## Constraints

- Static site on GitHub Pages. No server, no backend, no build step. Deploy is `git push`.
- No runtime dependencies. The site ships as plain files.
- Dev tooling only: `node --test` with `tests/harness.js` (jsdom).
- Nothing sensitive is stored. Login exists for identity continuity and to gate the dev/live toggle.

## Architecture

### The nav manifest

One array in `nav.js` is the single source of truth. It drives the top bar, the flyout, and the
dev/live filter.

```js
const NAV = [
  { id: 'home',      label: 'Home',      href: '/',               status: 'live', children: [] },
  { id: 'utilities', label: 'Utilities', href: 'utilities.html',  status: 'live', children: [
      { id: 'duo-chat', label: 'Duo chat', status: 'dev' },
  ]},
  { id: 'assistant', label: 'Assistant', href: 'interface.html',  status: 'live', children: [] },
  { id: 'media',     label: 'Media',     href: 'media.html',      status: 'live', children: [
      { id: 'articles',   label: 'Articles',   status: 'live' },
      { id: 'visualiser', label: 'Visualiser', status: 'dev'  },
  ]},
  { id: 'solutions', label: 'Solutions', href: 'solutions.html',  status: 'live', children: [
      { id: 'case-studies', label: 'Case studies', status: 'dev' },
      { id: 'pipelines',    label: 'Pipelines',    status: 'dev' },
  ]},
];
```

**Visibility rules:**

- A top-level entry appears in the bar if its own `status` passes the current mode.
- Children are filtered independently by their own `status`.
- A live section with zero visible children renders normally but does not expand on click and shows
  an empty state. Sections do not disappear because their children were filtered — only their own
  `status` removes them.

### Modules

Each file has one responsibility and can be tested without the others.

| File | Responsibility | Depends on |
|---|---|---|
| `nav.js` | Manifest data + renders the bar and flyout | `mode.js` |
| `views.js` | Hash router; swaps `<section data-view>` panels within a page | `mode.js` |
| `mode.js` | Reads/writes `localStorage.thl_mode`; sets `data-mode` on `<html>` | none |
| `identity.js` | Key derivation, export/import, founder check | none |
| `nav.css` | Flyout expansion, stagger, active and dev styling | none |

`script.js` keeps its existing job (particles, typing, scroll animations) and is not touched beyond
removing the nav code that moves to `nav.js`.

### Nav interaction

The flyout is **inline and horizontal**. It expands from the right edge of the clicked item, on the
same line as the bar. Items after the clicked one slide right to make room.

- Click a top-level item: its visible children animate out to its right, staggered ~70ms apart.
- Click a different top-level item: the current flyout collapses, the new one expands.
- Click the same item again, click outside the bar, or press Escape: collapse.
- The active child is highlighted. Dev-status children carry an amber outline and a `DEV` badge.
- Clicking a top-level item opens its flyout **and** navigates to that section's page. Because that
  is a real page load, the renderer expands the current section's flyout automatically on load, so
  the bar arrives in the state the click implied. The load-time expansion skips the stagger
  animation; only user-initiated clicks animate.
- Clicking a child switches the view within the page (no page load).

**Top-level items are icons, not text labels.** Each section has a stroke SVG icon (24×24 viewBox,
1.6 stroke width, `currentColor`). The label is hidden by default and expands inline to the icon's
right on hover or keyboard focus, animating `max-width` from 0. The **active** section shows its
label permanently, so the current location is always readable without hovering. Every icon button
carries an `aria-label`, so the accessible name never depends on the hover state.

**Overflow.** Measured on the prototype (`docs/nav-prototype.html`):

| Configuration | Bar width needed |
|---|---|
| Text labels, nothing expanded | 1115px |
| Icons, nothing expanded | 903px |
| Icons, dev mode, Media expanded (worst case) | 1132px |

Icons remove roughly 210px. The worst case still exceeds a narrow window, so the bar is a three-zone
layout: the logo pinned left and the founder mode switch pinned right (both `position: sticky` inside
the scroll container, each with an opaque background), and only the middle link region scrolls. This
keeps the brand and the toggle on screen at all times — without it, scrolling truncated the logo to
"D LAB" and carried the mode switch off the edge entirely.

The link region must be `flex: 0 0 auto`, **not** `flex: 1`. With `flex: 1` its basis is 0, so it
shrinks below its content and the overflow hides underneath the sticky zone instead of extending the
bar's scroll width — the bar reports that it fits while visibly clipping the last pill.

**Mobile.** Below the existing hamburger breakpoint there is no room for an inline row. The flyout
becomes a nested indented list inside the open hamburger menu. No horizontal animation on mobile.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, the flyout appears and disappears
without the width transition or the stagger.

### Subsection views

Within a section page, each subsection is a sibling panel:

```html
<section data-view="articles">…</section>
<section data-view="visualiser" data-status="dev">…</section>
```

`views.js` shows one panel and hides the rest, and syncs `location.hash`. `hashchange` drives
navigation so browser back and forward work. On load it reads the hash; if absent or unresolvable it
falls back to the first visible view.

### Dev/live mode

`localStorage.thl_mode` holds `'live'` or `'dev'`. Default is `'live'`. `mode.js` sets
`data-mode="live"|"dev"` on `<html>` so CSS can respond without JS involvement.

Any element carrying `data-status="dev"` is hidden in live mode. In dev mode those elements get an
amber outline and a `DEV` badge so unfinished work is visible at a glance — which is the original
complaint that started this.

The mode toggle renders only when the current identity is a founder.

**Accepted trade-off:** dev content still ships in the JS payload to every visitor. Nobody can
stumble onto it, but someone reading the source can find it. This is accepted in exchange for one
codebase and a zero-build deploy.

### Identity

Nothing sensitive is stored, so this is deliberately minimal.

```
password ──PBKDF2-SHA256(random salt, 600k iters)──▶ 32-byte key ──▶ identity
                                                          │
                                                          └──SHA-256──▶ compared to founder constants
```

- The user picks a password. The raw password is never stored — only the derived key is.
- PBKDF2 is used rather than plain SHA-256 because it is deliberately slow, which is what resists
  brute force. It is native to WebCrypto, so no dependency is added.
- The salt is generated randomly on signup and stored locally alongside the key.
- **Adding a device:** the derived key is displayed as a QR code and a word phrase. The second device
  imports the key directly and never re-derives it, so salt portability is not a problem.
- **Founder check:** `SHA-256(key)` compared against two constants committed in the source. These are
  safe to publish: they are hashes of high-entropy random keys, so they cannot be reversed or brute
  forced.

**Explicitly rejected — device fingerprinting as a credential.** Browsers cannot read device config
(no CPU serial, MAC, or disk ID — those need native code). The available signals are unstable
(a browser update, an external monitor, or travel changes the hash and locks the user out) and
insufficiently unique (identical laptop models produce identical hashes, so two users collide into
one account). It fails in both directions at once. It is also not a secret: every input is readable
by every site the user visits, and the hashing code ships in public JS.

**Extension point, not built now.** If the site later stores data that must stay private, the same
derived key feeds `AES-GCM` to encrypt it, so a stolen local blob yields ciphertext. There is no such
data today, so this is documented and not implemented.

## The assistant: tool router, no Ollama

`interface.html` today is an Ollama client. A visitor must install Ollama, set `OLLAMA_ORIGINS`, and
restart it before anything happens — so what most people actually see is a setup wall. It is marked
live but does not behave live, which is the exact problem this redesign exists to fix.

The assistant's real job is **routing**: read a plain-language request, pick a local tool, run it,
hand back the output. "Convert this to webp" runs the image converter and returns the file.

**This is already largely built** in the untracked worktree
`.claude/worktrees/elastic-varahamihira-370e25`, which contains:

- `tools/image-converter.{html,js}` — in-browser canvas conversion between PNG, JPG and WebP
- `detectImageConvertIntent()` — regex intent matching with typo tolerance (`pgn`→png,
  `wepb`→webp) and action-verb gating so "what is png?" does not match
- `detectSmallTalk()` — deterministic greeting and help responses
- On-demand tool script loading with cleanup
- `llmRoute()` — an Ollama fallback for anything the regex misses

**Recover this work first.** `.claude/worktrees/` is listed in `.gitignore` and `tools/` is untracked
even within the worktree, so this code exists in exactly one place and is invisible to git. Any
cleanup of that directory destroys it. It must be moved into `main` before anything is built on top.

The change is then subtractive: delete `llmRoute()` and its fallback path, keep `regexRoute()` and
`detectSmallTalk()`. One gap opens up — the LLM currently absorbs unmatched requests. Without it,
the no-match branch must reply with what the router *can* do and what it needs ("attach an image and
say convert to webp"), rather than failing silently.

Adding a tool means adding an intent matcher and a dispatcher entry. The nav manifest gains an
`assistant` section with `Tool router` and `Image converter` as live children.

## Error handling

| Condition | Behaviour |
|---|---|
| JS unavailable or fails | `<noscript>` block in each page lists the top-level links as plain anchors |
| Unknown or malformed URL hash | Falls back to the first visible view for that section |
| Dev-only view requested while in live mode | Redirects to the section's default view |
| Live section with no visible children | Renders normally, does not expand, shows empty state |
| Corrupt or unparseable stored key | Treated as signed out; user is prompted to sign in again |
| Import of a malformed key phrase or QR | Rejected with an inline message; existing identity untouched |

## Testing

Uses the existing `node --test` plus `tests/harness.js` jsdom setup.

- `nav.test.js` — manifest filtering per mode; renderer output structure; a live section with only
  dev children still renders but does not expand; Escape and outside-click collapse.
- `views.test.js` — hash routing; unknown-hash fallback; dev view blocked in live mode; `hashchange`
  updates the visible panel.
- `identity.test.js` — key derivation is deterministic for a given password and salt; export→import
  round-trips to the same key; founder hash matches for a known key and not for others; malformed
  import is rejected without clobbering existing state.

The flyout animation itself is not unit-testable and is verified by eye.

## Build order

Each step is independently shippable.

0. **Recover the tool router from the ignored worktree into `main`.** Do this first — the code is
   currently untracked inside a gitignored directory and one cleanup destroys it.
1. **Extract nav to manifest + renderer**, swap all five pages onto it. Zero visual change. This
   proves the refactor before any new behaviour rides on it.
2. **Inline flyout + subsection views on `media.html`** — the real cluttered case, with Articles and
   Visualiser already present.
3. **Roll views out** to Utilities and Solutions.
4. **Mode store + DEV badges**, including marking Duo Chat `status: 'dev'`.
5. **Identity + founder toggle.**

## Decisions made during design

| Decision | Choice | Reason |
|---|---|---|
| What login protects | Identity + founder toggle only | No sensitive data exists, so no threat model to defend against |
| Page model | One page per section, views swap client-side | A full page load would kill the flyout animation mid-flight |
| Flyout direction | Inline horizontal, from the right of the clicked item | Explicit user requirement |
| Duo Chat | `status: 'dev'` | Reversible, and exactly the case the dev/live split exists for |
| Password hashing | PBKDF2, not plain SHA-256 | SHA-256 is fast by design, so it is weak against GPU brute force |
| Local data encryption | Documented, not built | No sensitive data exists yet (YAGNI) |
| Top-level nav items | Icons with hover-revealed labels | Reclaims ~210px, which the inline flyout needs |
| Assistant backend | Regex tool router, Ollama deleted | Ollama needs install plus CORS setup, so it never behaved live |
