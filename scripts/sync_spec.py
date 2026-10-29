#!/usr/bin/env python3
"""sync_spec.py -- copies the tool spec into the Python package.

spec/manifest.json is the source of truth for the CLI, the intent parser
and the Python package alike. A wheel cannot reach outside its own root,
so the package needs its own copy at
python/thehallucinatedlab/data/manifest.json.

Rather than a build hook that runs invisibly, the copy is committed and
python/tests/test_registry.py asserts the two files are identical.
Editing the spec without running this turns the build red, which is the
point: there is no state where `thl tool` documents one thing and the
package accepts another.

    python scripts/sync_spec.py            copy
    python scripts/sync_spec.py --check    verify only, exit 1 on drift
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "spec" / "manifest.json"
TARGET = ROOT / "python" / "thehallucinatedlab" / "data" / "manifest.json"


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    source = SOURCE.read_bytes()

    if check_only:
        target = TARGET.read_bytes() if TARGET.exists() else None
        if target is None or target != source:
            print("spec/manifest.json and the packaged copy differ.", file=sys.stderr)
            print("Run: python scripts/sync_spec.py", file=sys.stderr)
            return 1
        print("spec is in sync")
        return 0

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(source)
    print("copied spec/manifest.json -> python/thehallucinatedlab/data/manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
