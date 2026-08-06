# thl.lab

A shorter name for [**thehallucinatedlab**](https://pypi.org/project/thehallucinatedlab/).

```bash
pip install thl.lab
```

That installs the real package. This one ships no code — it is metadata and a
single pinned dependency, so there is still exactly one import path and one
command:

```python
from thehallucinatedlab import convert
```

```bash
thl serve
```

Requires **Python 3.10 or newer**. On an older interpreter pip says
`No matching distribution found`, which reads like the package does not exist —
the real reason is the line above it in pip's output.

## Extras

Every extra the real package offers is mirrored here, so these are equivalent:

```bash
pip install "thl.lab[extract]"
pip install "thehallucinatedlab[extract]"
```

Available: `extract`, `chunk`, `embed`, `index`, `rag`, `eda`, `eda-excel`,
`eda-parquet`.

## Which name should I use?

Either. `thl.lab`, `thl-lab` and `thl_lab` are the same project — PyPI
normalises the separator — and all of them resolve to `thehallucinatedlab` at
the identical version. The pin is exact and CI enforces it, so the two can
never drift.

Prefer `thehallucinatedlab` in a dependency list you expect other people to
read; it is the canonical name and the one the documentation uses. Prefer
`thl.lab` when you are typing it by hand.

Source and issues: <https://github.com/The-Hallucinated-Lab/thehallucinatedlab>
