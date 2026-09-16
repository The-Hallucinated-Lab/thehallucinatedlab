#!/usr/bin/env bash
# Usage: ./.orchestrator/audit.sh <file> [max-lines]
# Dual adversarial audit only (no draft, no repair): GPU auditor + CPU adversary
# in parallel. Prints the union of findings, or CLEAN. For files Claude wrote
# itself and wants a second and third pair of eyes on. Nothing is modified.
set -uo pipefail
T="${1:?file required}"; MAX="${2:-30}"
{ echo "Audit this file. Output defects only, in the required format."; echo
  cat -n "$T"; } > .orchestrator/tmp/audit.txt
./.orchestrator/expert.sh adversary .orchestrator/tmp/audit.txt "$MAX" > .orchestrator/tmp/audit_b.out 2>.orchestrator/tmp/audit_b.err &
CPU_PID=$!
./.orchestrator/expert.sh auditor .orchestrator/tmp/audit.txt "$MAX" > .orchestrator/tmp/audit_a.out 2>.orchestrator/tmp/audit_a.err
wait $CPU_PID
# An auditor that said nothing did not audit. Refuse to call that CLEAN.
for side in a b; do
  if [ ! -s ".orchestrator/tmp/audit_${side}.out" ]; then
    echo "AUDIT_FAILED side=$side: $(head -c 200 ".orchestrator/tmp/audit_${side}.err" 2>/dev/null)" >&2
    AUDIT_BROKEN=1
  fi
done
D=$(cat .orchestrator/tmp/audit_a.out .orchestrator/tmp/audit_b.out | grep -E '^(CRITICAL|MAJOR|MINOR)\|' | sort -u)
LOG=".orchestrator/logs/audit-$(basename "$T").log"
{ echo "=== auditor ==="; cat .orchestrator/tmp/audit_a.out; echo "=== adversary ==="; cat .orchestrator/tmp/audit_b.out; } > "$LOG"
if [ "${AUDIT_BROKEN:-0}" = "1" ]; then echo "UNAUDITED file=$T"; exit 1; fi
if [ -z "$D" ]; then echo "CLEAN file=$T"; else echo "$D"; fi
