<!--
Keep this short. The diff says what changed; this says why, and what
you did to convince yourself it works.
-->

## What and why

<!-- One or two sentences. If it fixes a bug, say what the symptom was. -->

## Verification

<!--
Paste what you actually ran, not what you intended to run.
`npm run check` covers lint + JS tests + spec sync.
Python changes also need: ruff check python/ && pytest python/ -q
-->

- [ ] `npm run check` passes
- [ ] Visual change? Checked in **both** themes (the toggle is in the navbar)
- [ ] New behaviour has a test that fails without the fix

## Anything reviewers should look at twice

<!--
Optional. A decision you were unsure about, a trade-off you made, a
place where you want a second opinion. Delete if there is nothing.
-->
