#!/usr/bin/env bash
# Capture the tests that are already failing so verify.sh only reports NEW ones.
mkdir -p .orchestrator/baseline
pytest python/ -q --tb=no -p no:cacheprovider 2>/dev/null \
  | grep -oE '^FAILED [^ ]+' | sed -E 's/^FAILED //' \
  | sort -u > .orchestrator/baseline/failing.txt || true
echo "BASELINE_CAPTURED failing=$(wc -l < .orchestrator/baseline/failing.txt)"
