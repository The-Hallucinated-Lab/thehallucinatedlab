#!/usr/bin/env python
"""Fail on imports that do not resolve - the #1 local-model defect."""
import ast
import importlib.util
import pathlib
import sys

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
mods = set()
for n in ast.walk(ast.parse(src)):
    if isinstance(n, ast.Import):
        mods |= {a.name.split(".")[0] for a in n.names}
    elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
        mods.add(n.module.split(".")[0])
bad = [m for m in mods if importlib.util.find_spec(m) is None]
if bad:
    print("HALLUCINATED_OR_MISSING_IMPORTS: " + ", ".join(sorted(bad)))
    sys.exit(1)
