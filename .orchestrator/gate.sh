#!/usr/bin/env bash
# Usage: ./.orchestrator/gate.sh <path>
# Single-file mechanical gate for this repo (the thl package).
#   .py -> py_compile, ruff, mypy, hallucinated-import check
# Anything else has no gate here: this repository is Python only.
# Always `python` - never `python3` - two interpreters are on PATH.
set -uo pipefail
T="${1:?path required}"; FAIL=0
case "$T" in
  *.py)
    python -m py_compile "$T" || FAIL=1
    ruff check "$T" || FAIL=1
    mypy "$T" --ignore-missing-imports --no-error-summary --cache-dir "${TEMP:-${TMP:-/tmp}}/thl-mypy-cache" || FAIL=1
    python .orchestrator/imports.py "$T" || FAIL=1
    ;;
  *)
    echo "no gate for $T — this repository is Python only"
    ;;
esac
exit $FAIL
