#!/usr/bin/env bash
# Usage: ./.orchestrator/verify.sh [--repair]
# Full-project verification after EVERY integration. One line on success,
# a bounded summary on failure. --repair is accepted for protocol parity, but a
# pytest failure does not map to one source file, so it only summarises.
set -uo pipefail
RUN=".orchestrator/tmp/verify.out"; : > "$RUN"
mkdir -p .orchestrator/baseline .orchestrator/tmp
touch .orchestrator/baseline/failing.txt

echo "--- lint ---" >> "$RUN"
ruff check python/ >> "$RUN" 2>&1; LINT=$?

echo "--- syntax ---" >> "$RUN"
SYNTAX=0
for f in $(git ls-files '*.py'); do
  python -m py_compile "$f" >> "$RUN" 2>&1 || SYNTAX=1
done

echo "--- spec sync ---" >> "$RUN"
python scripts/sync_spec.py --check >> "$RUN" 2>&1; SPEC=$?

echo "--- tests ---" >> "$RUN"
pytest python/ -q --tb=no -p no:cacheprovider > .orchestrator/tmp/pytest.out 2>&1; TESTS=$?
grep -oE '^FAILED [^ ]+' .orchestrator/tmp/pytest.out | sed -E 's/^FAILED //' \
  | sort -u > .orchestrator/tmp/now_failing.txt
tail -1 .orchestrator/tmp/pytest.out >> "$RUN"
NEW=$(comm -13 .orchestrator/baseline/failing.txt .orchestrator/tmp/now_failing.txt)
PASSED=$(grep -oE '[0-9]+ passed' .orchestrator/tmp/pytest.out | grep -oE '^[0-9]+' | head -1)

if [ "$LINT" -eq 0 ] && [ "$SYNTAX" -eq 0 ] && [ "$SPEC" -eq 0 ] && [ -z "$NEW" ]; then
  echo "VERIFY_PASS - ${PASSED:-?} tests, 0 new failures, lint clean"; exit 0
fi

echo "VERIFY_FAIL lint=$LINT syntax=$SYNTAX spec=$SPEC tests=$TESTS"
[ -n "$NEW" ] && { echo "NEW_FAILURES:"; echo "$NEW" | head -20; }
[ "$LINT" -ne 0 ] && { echo "LINT:"; grep -nE 'error|warning' "$RUN" | head -20; }
exit 1
