# Releasing the THL library

The site deploys itself — GitHub Pages serves `main`, there is no build step. This document
is only about the Python package in `python/`.

## One-time setup on PyPI

`.github/workflows/release.yml` publishes with **Trusted Publishing**, so no API token is
stored in this repository and there is nothing to rotate or leak. PyPI verifies the workflow
identity over OIDC instead.

That requires one thing that can only be done from a PyPI account, and it must be done
before the first tag is pushed:

1. Sign in at <https://pypi.org> and open **Your projects → Publishing**
   (direct link: <https://pypi.org/manage/account/publishing/>).
2. Under **Add a new pending publisher**, fill in:

   | Field | Value |
   |---|---|
   | PyPI Project Name | `thehallucinatedlab` |
   | Owner | `The-Hallucinated-Lab` |
   | Repository name | `thehallucinatedlab` |
   | Workflow name | `release.yml` |
   | Environment name | `pypi` |

3. Save.

The environment name matters — the publish job declares `environment: pypi`, and PyPI will
reject the upload if the two do not match.

A *pending* publisher is the right choice while the project does not exist on PyPI yet; it
turns into a normal publisher on the first successful upload.

### Do it a second time for the alias

`alias/` publishes a second project, `thl.lab`, whose only job is to make
`pip install thl.lab` reach the same toolkit. Trusted publishing is configured **per
project**, so it needs its own pending publisher with every field identical except the
first:

| Field | Value |
|---|---|
| PyPI Project Name | `thl.lab` |
| Owner | `The-Hallucinated-Lab` |
| Repository name | `thehallucinatedlab` |
| Workflow name | `release.yml` |
| Environment name | `pypi` |

Until that exists, the release will build both packages, publish `thehallucinatedlab`
successfully, and then fail on the `Publish thl.lab` step with `invalid-publisher`. The
first upload is not lost — PyPI is append-only in the useful direction here — but the tag
will show a red run until the publisher is added and the job re-run.

`thl` itself was not available: an unrelated placeholder claimed it in December 2025.
`thl.lab` is the shortest name that was free. PEP 503 normalises separators, so `thl.lab`,
`thl-lab` and `thl_lab` are one project and any spelling installs it.

## Cutting a release

Versions live in **four** places and CI refuses to publish if any of them disagree:

- `python/pyproject.toml` → `project.version`
- `python/thehallucinatedlab/__init__.py` → `__version__`
- `alias/pyproject.toml` → `project.version`
- `alias/pyproject.toml` → the `thehallucinatedlab==` pin in `dependencies`

The alias pins an exact version deliberately. An alias that can resolve to a different
version than the package it aliases is not an alias — it is a second package that will
surprise somebody. `test/regressions.test.js` checks the pin on every CI run, and the
release workflow checks it again against the tag before building anything.

`spec/manifest.json` also carries a `version`, which is the *spec* version — bump it when the
shape of a tool's arguments changes, not on every release. A test asserts it matches the
package version, so for now they move together.

```bash
# 1. bump the version in both files, and the spec if arguments changed
# 2. make sure the packaged spec copy is current
node scripts/sync-spec.js

# 3. verify locally exactly what CI will verify
node --test "test/**/*.test.js"
pytest python/ -q
ruff check python/

# 4. commit, then tag and push
git tag v0.1.0
git push origin v0.1.0
```

Pushing the tag runs `release.yml`, which lints, tests, checks the spec is in sync, verifies
the tag matches `pyproject.toml`, builds an sdist and a wheel, runs `twine check --strict`,
and only then mints an OIDC token to publish.

**PyPI is append-only.** A version number can never be reused, even after deleting a
release. That is why the tag/version check runs before the build rather than after.

## Verifying a release

```bash
python -m venv /tmp/thl && /tmp/thl/bin/pip install thehallucinatedlab
/tmp/thl/bin/thl tools
/tmp/thl/bin/python -c "from thehallucinatedlab import convert; print(convert)"
```

## If the publish step fails

- **`invalid-publisher`** — the pending publisher does not exist yet, or one of its five
  fields does not match. Environment name is the usual culprit.
- **`File already exists`** — that version was already uploaded. Bump the version; the old
  number is gone for good.
- **Tag/version mismatch** — the workflow stopped before building. Delete the tag
  (`git push --delete origin vX.Y.Z`), fix the version, and tag again.
