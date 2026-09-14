#!/usr/bin/env bash
# Usage: ./.orchestrator/ask.sh <file|-> "<question>" [max-lines]
# The reader shortcut: bounded answer from the content of one file (or stdin).
set -euo pipefail
SRC="${1:?file or - required}"; Q="${2:?question required}"; MAX="${3:-20}"
BODY=$([ "$SRC" = "-" ] && cat || cat "$SRC")
{ echo "Hard limit: $MAX lines."; echo; echo "QUESTION: $Q"; echo
  echo "--- CONTENT START ---"; echo "$BODY"; echo "--- CONTENT END ---"
} > .orchestrator/tmp/ask.txt
./.orchestrator/expert.sh reader .orchestrator/tmp/ask.txt "$MAX"
