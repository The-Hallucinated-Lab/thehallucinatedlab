#!/usr/bin/env bash
# Usage: ./.orchestrator/expert.sh <expert> <prompt-file> [max-lines]
# Thin wrapper: the work is in expert.js (Ollama HTTP API - clean stdout,
# real per-expert temperature). Kept so the protocol's call sites hold.
set -euo pipefail
exec node "$(dirname "$0")/expert.js" "$@"
