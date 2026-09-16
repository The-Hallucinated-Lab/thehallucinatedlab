#!/usr/bin/env bash
# Usage: ./.orchestrator/gate.sh <path>
# Single-file mechanical gate for this repo (static site + python package).
#   .py   -> py_compile, ruff, mypy, hallucinated-import check
#   .js   -> node --check (module syntax under dictionary/assets/js), eslint
#   .css  -> brace balance + site-invariants suite
#   .html -> site-invariants + seo-invariants + regressions suites
# Always `python` (3.14, Pillow) - never `python3` - two interpreters are on PATH.
set -uo pipefail
T="${1:?path required}"; FAIL=0
case "$T" in
  *.py)
    python -m py_compile "$T" || FAIL=1
    ruff check "$T" || FAIL=1
    mypy "$T" --ignore-missing-imports --no-error-summary --cache-dir "${TEMP:-${TMP:-/tmp}}/thl-mypy-cache" || FAIL=1
    python .orchestrator/imports.py "$T" || FAIL=1
    ;;
  *.js)
    case "$T" in
      dictionary/assets/js/*) node --input-type=module --check < "$T" || FAIL=1 ;;
      *) node --check "$T" || FAIL=1 ;;
    esac
    npx eslint "$T" || FAIL=1
    ;;
  *.css)
    node .orchestrator/braces.js "$T" || FAIL=1
    node --test test/site-invariants.test.js >/dev/null 2>&1 || { echo "site-invariants FAILED"; FAIL=1; }
    ;;
  *.html)
    node --test test/site-invariants.test.js test/seo-invariants.test.js test/regressions.test.js >/dev/null 2>&1 \
      || { echo "html invariants FAILED"; FAIL=1; }
    ;;
esac
exit $FAIL
