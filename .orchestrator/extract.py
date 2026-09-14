#!/usr/bin/env python
"""Pull the largest fenced code block out of raw model output."""
import re
import sys

raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
blocks = re.findall(r"```(?:[a-zA-Z0-9+#.-]*)\n(.*?)```", raw, re.S)
out = max(blocks, key=len) if blocks else raw
open(sys.argv[2], "w", encoding="utf-8", newline="\n").write(out.rstrip() + "\n")
print(f"EXTRACTED_LINES={len(out.splitlines())} BLOCKS={len(blocks)}")
