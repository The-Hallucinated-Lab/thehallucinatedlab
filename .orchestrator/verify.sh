#!/usr/bin/env bash
# Usage: ./.orchestrator/verify.sh [--repair]
# Full-project verification after EVERY integration. One line on success,
# a bounded summary on failure. --repair is accepted for protocol parity, but a
# node test failure does not map to one source file, so it only summarises.
set -uo pipefail
RUN=".orchestrator/tmp/verify.out"; : > "$RUN"
mkdir -p .orchestrator/baseline .orchestrator/tmp
touch .orchestrator/baseline/failing.txt

echo "--- lint ---" >> "$RUN"
npm run lint --silent >> "$RUN" 2>&1; LINT=$?

echo "--- syntax ---" >> "$RUN"
SYNTAX=0
for f in $(git ls-files '*.js' | grep -v '^assets/vendor/'); do
  case "$f" in
    dictionary/assets/js/*) node --input-type=module --check < "$f" >> "$RUN" 2>&1 || SYNTAX=1 ;;
    *) node --check "$f" >> "$RUN" 2>&1 || SYNTAX=1 ;;
  esac
done

echo "--- spec sync ---" >> "$RUN"
node scripts/sync-spec.js --check >> "$RUN" 2>&1; SPEC=$?
SHELL_SYNC=0
if [ -f scripts/sync-shell.js ]; then
  echo "--- shell sync ---" >> "$RUN"
  node scripts/sync-shell.js --check >> "$RUN" 2>&1; SHELL_SYNC=$?
fi

echo "--- tests ---" >> "$RUN"
node --test --test-reporter=tap "test/**/*.test.js" > .orchestrator/tmp/tap.out 2>&1; TESTS=$?
grep -oE '^\s*not ok [0-9]+ - .*' .orchestrator/tmp/tap.out | sed -E 's/^\s*not ok [0-9]+ - //' \
  | sort -u > .orchestrator/tmp/now_failing.txt
grep -E '^# (pass|fail) ' .orchestrator/tmp/tap.out >> "$RUN"
NEW=$(comm -13 .orchestrator/baseline/failing.txt .orchestrator/tmp/now_failing.txt)
PASSED=$(grep -oE '^# pass [0-9]+' .orchestrator/tmp/tap.out | grep -oE '[0-9]+$')

if [ "$LINT" -eq 0 ] && [ "$SYNTAX" -eq 0 ] && [ "$SPEC" -eq 0 ] && [ "$SHELL_SYNC" -eq 0 ] && [ -z "$NEW" ]; then
  echo "VERIFY_PASS - ${PASSED:-?} tests, 0 new failures, lint clean"; exit 0
fi

echo "VERIFY_FAIL lint=$LINT syntax=$SYNTAX spec=$SPEC shell=$SHELL_SYNC tests=$TESTS"
[ -n "$NEW" ] && { echo "NEW_FAILURES:"; echo "$NEW" | head -20; }
[ "$LINT" -ne 0 ] && { echo "LINT:"; grep -nE 'error|warning' "$RUN" | head -20; }
[ "$SHELL_SYNC" -ne 0 ] && { echo "SHELL_SYNC:"; grep -iE 'stale|differ' "$RUN" | head -10; }
exit 1
