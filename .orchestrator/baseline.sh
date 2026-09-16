#!/usr/bin/env bash
# Capture the tests that are already failing so verify.sh only reports NEW ones.
mkdir -p .orchestrator/baseline
node --test --test-reporter=tap "test/**/*.test.js" 2>/dev/null \
  | grep -oE '^\s*not ok [0-9]+ - .*' | sed -E 's/^\s*not ok [0-9]+ - //' \
  | sort -u > .orchestrator/baseline/failing.txt || true
echo "BASELINE_CAPTURED failing=$(wc -l < .orchestrator/baseline/failing.txt)"
