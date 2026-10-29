<!--
Keep this short. The diff says what changed; this says why, and what
you did to convince yourself it works.
-->

## What and why

<!-- One or two sentences. If it fixes a bug, say what the symptom was. -->

## Verification

<!--
Paste what you actually ran, not what you intended to run.
The full check is:
  ruff check python/ && pytest python/ -q && python scripts/sync_spec.py --check
-->

- [ ] `ruff check python/` passes
- [ ] `pytest python/ -q` passes
- [ ] `python scripts/sync_spec.py --check` passes
- [ ] Changed the spec? Ran `python scripts/sync_spec.py`
- [ ] New behaviour has a test that fails without the fix
- [ ] Appended an entry to section 5 of `CONTEXT.md`

## Anything reviewers should look at twice

<!--
Optional. A decision you were unsure about, a trade-off you made, a
place where you want a second opinion. Delete if there is nothing.
-->
