#!/usr/bin/env bash
# Usage: ./.orchestrator/moe.sh <packet.txt> <target-file> [expert] [max-attempts]
# draft -> gate -> repair loop -> dual audit (GPU auditor + CPU adversary) -> repair -> re-gate
set -uo pipefail
PACKET="${1:?packet required}"; TARGET="${2:?target required}"
EXPERT="${3:-implementer}"; MAX="${4:-4}"
LOG=".orchestrator/logs/$(basename "$TARGET").log"; : > "$LOG"
PROMPT=$(cat "$PACKET")

# ---------- PHASE 1: draft + mechanical repair loop ----------
for i in $(seq 1 "$MAX"); do
  echo "=== DRAFT $i expert=$EXPERT ===" >> "$LOG"
  echo "$PROMPT" > .orchestrator/tmp/cur.txt
  ./.orchestrator/expert.sh "$EXPERT" .orchestrator/tmp/cur.txt > .orchestrator/tmp/raw.out 2>>"$LOG"
  python .orchestrator/extract.py .orchestrator/tmp/raw.out "$TARGET" >> "$LOG"

  if GATE=$(./.orchestrator/gate.sh "$TARGET" 2>&1); then
    echo "GATE_PASS attempt=$i" >> "$LOG"; break
  fi
  echo "$GATE" | tail -40 >> "$LOG"
  if [ "$i" -eq "$MAX" ]; then
    echo "FAIL_GATE file=$TARGET"
    ./.orchestrator/ask.sh "$LOG" "Single root cause of these repeated failures? Max 6 lines." 6
    exit 1
  fi
  [ "$i" -ge 2 ] && EXPERT="heavy-implementer"
  PROMPT="$(cat "$PACKET")

YOUR PREVIOUS ATTEMPT FAILED VERIFICATION.
--- YOUR CODE ---
$(cat "$TARGET")
--- ERRORS (fix exactly these, change nothing else) ---
$(echo "$GATE" | tail -40)
Return the complete corrected file in one fenced code block."
done

# ---------- PHASE 2: dual adversarial audit (GPU + CPU, in parallel) ----------
{ echo "Audit this file. Output defects only, in the required format."; echo
  cat -n "$TARGET"; } > .orchestrator/tmp/audit.txt
./.orchestrator/expert.sh adversary .orchestrator/tmp/audit.txt 25 > .orchestrator/tmp/audit_b.out 2>/dev/null &
CPU_PID=$!
./.orchestrator/expert.sh auditor .orchestrator/tmp/audit.txt 25 > .orchestrator/tmp/audit_a.out 2>/dev/null
wait $CPU_PID
DEFECTS=$(cat .orchestrator/tmp/audit_a.out .orchestrator/tmp/audit_b.out \
  | grep -E '^(CRITICAL|MAJOR)\|' | sort -u)
echo "=== AUDIT ===" >> "$LOG"; echo "$DEFECTS" >> "$LOG"

# ---------- PHASE 3: repair audit findings ----------
if [ -n "$DEFECTS" ]; then
  { echo "Fix ONLY these reported defects. Change nothing else."; echo
    echo "--- DEFECTS ---"; echo "$DEFECTS"; echo
    echo "--- FILE ---"; cat "$TARGET"; } > .orchestrator/tmp/repair.txt
  ./.orchestrator/expert.sh repairer .orchestrator/tmp/repair.txt > .orchestrator/tmp/raw.out 2>>"$LOG"
  if grep -q '^BLOCKED:' .orchestrator/tmp/raw.out; then
    echo "BLOCKED file=$TARGET"; grep '^BLOCKED:' .orchestrator/tmp/raw.out; exit 1
  fi
  cp "$TARGET" "$TARGET.prerepair"
  python .orchestrator/extract.py .orchestrator/tmp/raw.out "$TARGET" >> "$LOG"
  if ! ./.orchestrator/gate.sh "$TARGET" >> "$LOG" 2>&1; then
    mv "$TARGET.prerepair" "$TARGET"; echo "REPAIR_REVERTED file=$TARGET"
  fi
  rm -f "$TARGET.prerepair"
fi

echo "PASS file=$TARGET defects_fixed=$(echo "$DEFECTS" | grep -c .)"
