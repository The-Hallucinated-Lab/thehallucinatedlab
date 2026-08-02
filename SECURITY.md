# Security Policy

## Reporting a vulnerability

Email **thehallucinatedlab@gmail.com** with `SECURITY` in the subject line.

Please include what you found, the page or file it affects, and the steps
to reproduce it. If you have a proof of concept, a short description beats
a screenshot.

We will acknowledge your report within **7 days** and tell you what we
intend to do about it. Please give us a reasonable window to ship a fix
before disclosing publicly — this is a two-person project, so that window
may be longer than you are used to.

Do not open a public GitHub issue for a security problem.

## Scope

This repository is a **static website**. There is no server we run, no
database, no user accounts, and no session handling. That rules out most
of the classes of bug people usually look for. What is genuinely in scope:

- Cross-site scripting in any page or in the JavaScript that renders into
  it — `articles.js`, `interface.js`, `tools.js`, `articles/article.js`
- A Content-Security-Policy bypass on any page
- Anything that causes the Assistant page to send data off the visitor's
  machine (see below)
- Secrets or credentials committed anywhere in this repository or its
  history
- Subresource or supply-chain problems in `assets/vendor/`

Out of scope: findings against `thehallucinatedlab.space` that are
properties of GitHub Pages itself, missing response headers we cannot set
(see *Known limitations*), and automated-scanner output with no
demonstrated impact.

## The Assistant page

`interface.html` connects to an [Ollama](https://ollama.com) runtime on
the visitor's **own machine** at `http://localhost:11434`. No prompt,
response, or attachment is sent to any server we operate — there is no
such server. `connect-src` in that page's CSP is restricted to `'self'`
plus loopback, so the page cannot reach anywhere else even if its
JavaScript were compromised.

Model output is rendered through `formatMarkdown()` in
[`interface.js`](interface.js), which escapes the text first and then
re-introduces a fixed set of tags. It never emits an attribute, so there
is no place for injected markup to attach an event handler. If you find a
string that escapes that, we want to hear about it.

## Known limitations

GitHub Pages serves static files and does not let us set response
headers. Everything expressible in a `<meta>` tag is set on every page —
the CSP and `Referrer-Policy` — but the following can only be delivered
as real headers and are therefore **not** in force:

| Header | Status |
|---|---|
| `Content-Security-Policy: frame-ancestors` | Not set — `<meta>` CSP ignores this directive. Clickjacking is not currently blocked. |
| `X-Frame-Options` | Not set — header-only. |
| `X-Content-Type-Options: nosniff` | Not set — header-only. GitHub Pages does send correct `Content-Type` values. |
| `Permissions-Policy` | Not set — header-only. |
| `Strict-Transport-Security` | Managed by GitHub Pages when *Enforce HTTPS* is enabled. |

Putting the site behind a CDN or proxy that can set headers would close
all of these. Until then they are documented here rather than assumed.

## What this project does not do

No cookies. No localStorage beyond community post drafts, which stay in
the visitor's browser and are never transmitted. No analytics, no
tracking pixels, no third-party scripts — every subresource on every page
is served same-origin from this repository.
