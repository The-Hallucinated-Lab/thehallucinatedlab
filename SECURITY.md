# Security Policy

## Reporting a vulnerability

Email **thehallucinatedlab@gmail.com** with `SECURITY` in the subject line.

Please include what you found, the file or tool it affects, and the steps to
reproduce it. If you have a proof of concept, a short description beats a
screenshot.

We will acknowledge your report within **7 days** and tell you what we intend
to do about it. Please give us a reasonable window to ship a fix before
disclosing publicly — this is a two-person project, so that window may be
longer than you are used to.

Do not open a public GitHub issue for a security problem.

## Scope

This repository is a **pip package** (`python/`) and a **command-line tool**
(`thl`). There is no server we run, no database, no user accounts and no
session handling. That rules out most of the classes of bug people usually
look for. What is genuinely in scope:

- Path traversal through a destination argument — a tool writing outside the
  path the caller asked for
- A tool executing attacker-controlled input rather than treating it as data
- In `extract`: a malicious document that causes arbitrary code execution
  rather than a parse failure
- In `index`: anything that makes the generated `query.py` run something the
  caller did not ask for
- Dependency confusion or a typosquatted name in the published metadata
- Secrets or credentials committed anywhere in this repository or its history

## What this project does not do

No network calls at all in the base tools. No telemetry, no analytics, no
phone-home. The RAG extras download model weights the first time you use them,
from the model's own distribution channel, and that is the only outbound
traffic in the package.

No credential is stored, and nothing is uploaded. A document you `extract` or
a table you `eda` stays on your disk.

## Trust boundary worth naming

`thl tool extract` parses untrusted documents with third-party parsers
(`pypdf`, `python-docx`, `python-pptx`, `openpyxl`, `ebooklib`, `striprtf`,
`odfpy`, `beautifulsoup4`). We treat those libraries as the boundary: a
malformed file should produce a `THLError` naming the file, and a crash
inside a parser is a bug we want to hear about.

The EDA pipeline emits an `analysis.py` you are meant to edit and run. It is
generated from your data's column names, so it is worth reading before
executing on a file from an untrusted source — the same caution you would
apply to any generated code.
