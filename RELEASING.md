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

## Cutting a release

Versions live in two places and CI refuses to publish if they disagree:

- `python/pyproject.toml` → `project.version`
- `python/thehallucinatedlab/__init__.py` → `__version__`

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
/tmp/thl/bin/python -c "from thehallucinatedlab import converter; print(converter)"
```

## If the publish step fails

- **`invalid-publisher`** — the pending publisher does not exist yet, or one of its five
  fields does not match. Environment name is the usual culprit.
- **`File already exists`** — that version was already uploaded. Bump the version; the old
  number is gone for good.
- **Tag/version mismatch** — the workflow stopped before building. Delete the tag
  (`git push --delete origin vX.Y.Z`), fix the version, and tag again.
