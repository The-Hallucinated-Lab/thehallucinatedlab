#!/usr/bin/env bash
# Usage: ./.orchestrator/expert.sh <expert> <prompt-file> [max-lines]
# Runs one local expert (Ollama) with its role file prepended. Text in, text out.
set -euo pipefail
E="${1:?expert required}"; P="${2:?prompt file required}"; MAX="${3:-0}"
ROW=$(awk -F'\t' -v e="$E" '$1==e{print;exit}' .orchestrator/experts.tsv)
[ -z "$ROW" ] && { echo "UNKNOWN_EXPERT: $E" >&2; exit 2; }
MODEL=$(echo "$ROW" | cut -f2); ROLE=$(echo "$ROW" | cut -f4)
OUT=$( { cat ".orchestrator/experts/$ROLE"; echo; cat "$P"; } \
  | ollama run "$MODEL" 2>/dev/null )
if [ "$MAX" -gt 0 ]; then echo "$OUT" | head -n "$MAX"; else echo "$OUT"; fi
