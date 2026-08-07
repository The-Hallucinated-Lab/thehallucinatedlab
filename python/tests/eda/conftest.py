"""Fixtures shared by the suite.

The adversarial column set is the important one. Type inference is the
product -- every failure a user notices is a misclassification -- so the
fixtures are built from the specific columns that break profilers: zip
codes, 0/1/2 encodings, dates in competing formats, 99%-null floats,
UUIDs, constants, mixed types, integers stored as floats because one
value was missing.
"""

from __future__ import annotations

from pathlib import Path

import pytest

pd = pytest.importorskip("pandas")
np = pytest.importorskip("numpy")
pytest.importorskip("matplotlib")
pytest.importorskip("scipy")


N = 400


def adversarial_frame(n: int = N) -> pd.DataFrame:
    """Forty-plus columns, each chosen because it misclassifies somewhere.

    The expected type for each is in :data:`EXPECTED_TYPES`, keyed by the
    same name, so a column and its expectation cannot drift apart.
    """
    rng = np.random.default_rng(20240115)
    return pd.DataFrame(
        {
            # -- identifiers ------------------------------------------------
            "id": range(n),
            "uuid": [f"{i:08x}-1a2b-3c4d-5e6f-000000000000" for i in range(n)],
            "order_id": [f"ORD-{i:06d}" for i in range(n)],
            "customer_key": [f"K{i:05d}" for i in range(n)],
            "sku": [f"SKU{i % 300:04d}" for i in range(n)],
            # -- numeric continuous -----------------------------------------
            "revenue": np.round(rng.lognormal(6, 0.7, n), 2),
            "temperature": np.round(rng.normal(21, 4, n), 1),
            "ratio": rng.random(n),
            "negative_only": -np.round(rng.random(n) * 50 + 1, 2),
            "with_zeros": np.round(rng.random(n) * 10, 2) * (rng.random(n) > 0.3),
            # integers that arrived as floats because a value was missing
            "int_with_nan": [float(i % 500) if i % 11 else None for i in range(n)],
            # -- numeric discrete -------------------------------------------
            "quantity": rng.integers(1, 9, n),
            "rating": rng.choice([0, 1, 2], n),
            "zip": rng.choice([10001, 20002, 30003, 44444], n),
            "postcode": rng.choice([560001, 560002, 560003], n),
            "year": rng.choice([2021, 2022, 2023], n),
            "product_code": rng.integers(100, 140, n),
            "star_rating": rng.integers(1, 6, n),
            # -- boolean ------------------------------------------------------
            "native_bool": rng.choice([True, False], n),
            "yes_no": rng.choice(["yes", "no"], n),
            "y_n": rng.choice(["Y", "N"], n),
            "true_false": rng.choice(["TRUE", "FALSE"], n),
            "zero_one": rng.choice([0, 1], n),
            "t_f": rng.choice(["t", "f"], n),
            # -- categorical --------------------------------------------------
            "region": rng.choice(["north", "south", "east", "west"], n),
            "channel": rng.choice(["web", "app", "store", "phone", "partner"], n),
            "city": rng.choice([f"city{i}" for i in range(90)], n),
            "browser": rng.choice([f"ua-{i}" for i in range(60)], n),
            # -- datetime -----------------------------------------------------
            "iso_date": pd.date_range("2023-01-01", periods=n, freq="D").astype(str),
            "iso_stamp": pd.date_range("2023-01-01", periods=n, freq="7h").astype(str),
            "native_dt": pd.date_range("2022-06-01", periods=n, freq="D"),
            "us_date": [f"{(i % 12) + 1:02d}/{(i % 28) + 1:02d}/2023" for i in range(n)],
            # day and month both <= 12 and never equal: genuinely ambiguous
            "ambiguous_date": [
                f"{(i % 12) + 1:02d}/{((i + 4) % 12) + 1:02d}/2023" for i in range(n)
            ],
            "text_month": [f"{(i % 28) + 1:02d} Mar 2023" for i in range(n)],
            "irregular_dt": pd.to_datetime(
                pd.Series(
                    np.cumsum(rng.choice([1, 1, 1, 2, 30], n)), name="d"
                ).map(lambda days: pd.Timestamp("2023-01-01") + pd.Timedelta(days=int(days)))
            ),
            # -- free text -----------------------------------------------------
            "comment": [
                " ".join(rng.choice(["late", "fast", "broken", "great", "again"], 8))
                for _ in range(n)
            ],
            "address": [f"{i} Some Long Street Name, Some Town, Region" for i in range(n)],
            # -- degenerate ------------------------------------------------------
            "constant": ["only"] * n,
            "near_constant": ["same"] * (n - 1) + ["other"],
            "all_null": [None] * n,
            # Two surviving values out of four hundred. Deliberately not
            # whole numbers: an integer-shaped sparse column is a different
            # bug, and this one is about inferring from almost no evidence.
            "sparse_float": [i + 0.5 if i % 200 == 0 else None for i in range(n)],
            "sparse_text": ["value" if i % 150 == 0 else None for i in range(n)],
            "empty_strings": ["" if i % 3 else "x" for i in range(n)],
            # -- unsupported -------------------------------------------------------
            "mixed": [i if i % 2 else f"text{i}" for i in range(n)],
            "listy": [[1, 2, 3] for _ in range(n)],
            "dicty": [{"a": 1} for _ in range(n)],
        }
    )


#: What each adversarial column must be read as. Anything here that
#: regresses is a user-visible misclassification, which is the failure
#: mode this whole module exists to prevent.
EXPECTED_TYPES: dict[str, str] = {
    "id": "identifier",
    "uuid": "identifier",
    "order_id": "identifier",
    "customer_key": "identifier",
    "sku": "categorical_high",
    "revenue": "numeric_continuous",
    "temperature": "numeric_continuous",
    "ratio": "numeric_continuous",
    "negative_only": "numeric_continuous",
    "with_zeros": "numeric_continuous",
    "int_with_nan": "numeric_continuous",
    "quantity": "numeric_discrete",
    "rating": "numeric_discrete",
    "zip": "numeric_discrete",
    "postcode": "numeric_discrete",
    "year": "numeric_discrete",
    "product_code": "numeric_discrete",
    "star_rating": "numeric_discrete",
    "native_bool": "boolean",
    "yes_no": "boolean",
    "y_n": "boolean",
    "true_false": "boolean",
    "zero_one": "boolean",
    "t_f": "boolean",
    "region": "categorical_low",
    "channel": "categorical_low",
    "city": "categorical_high",
    "browser": "categorical_high",
    "iso_date": "datetime",
    "iso_stamp": "datetime",
    "native_dt": "datetime",
    "us_date": "datetime",
    "ambiguous_date": "datetime",
    "text_month": "datetime",
    "irregular_dt": "datetime",
    "comment": "free_text",
    "address": "free_text",
    "constant": "constant",
    "near_constant": "constant",
    "all_null": "empty",
    "sparse_float": "numeric_continuous",
    "sparse_text": "constant",
    "empty_strings": "categorical_low",
    "mixed": "unsupported",
    "listy": "unsupported",
    "dicty": "unsupported",
}


def simple_frame(n: int = 300) -> pd.DataFrame:
    """A small, well-behaved dataset for tests about everything else."""
    rng = np.random.default_rng(11)
    frame = pd.DataFrame(
        {
            "order_id": [f"ORD-{i:05d}" for i in range(n)],
            "revenue": np.round(rng.lognormal(5.5, 0.6, n), 2),
            "quantity": rng.integers(1, 7, n),
            "region": rng.choice(["north", "south", "east"], n),
            "city": rng.choice([f"city{i}" for i in range(40)], n),
            "signup": pd.date_range("2023-01-01", periods=n, freq="D").astype(str),
            "churn": rng.choice(["yes", "no"], n, p=[0.3, 0.7]),
            "note": [" ".join(rng.choice(["ok", "bad", "good"], 5)) for _ in range(n)],
            "tier": ["gold"] * n,
            "unused": [None] * n,
        }
    )
    frame.loc[rng.choice(n, 30, replace=False), "revenue"] = np.nan
    frame.loc[rng.choice(n, 20, replace=False), "region"] = None
    return frame


@pytest.fixture
def simple_csv(tmp_path: Path) -> Path:
    path = tmp_path / "sales.csv"
    simple_frame().to_csv(path, index=False)
    return path


@pytest.fixture
def adversarial_csv(tmp_path: Path) -> Path:
    """The adversarial frame minus the columns a CSV cannot round-trip.

    Lists and dicts become their ``repr`` on the way through a CSV, so
    they are exercised in-memory instead -- writing them out would test
    the CSV writer rather than the inference.
    """
    path = tmp_path / "adversarial.csv"
    adversarial_frame().drop(columns=["listy", "dicty"]).to_csv(path, index=False)
    return path


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    """Two good files, one corrupt, one empty. Folder mode must survive it."""
    directory = tmp_path / "data"
    directory.mkdir()
    simple_frame(200).to_csv(directory / "a.csv", index=False)
    simple_frame(120).to_csv(directory / "b.csv", index=False)
    (directory / "broken.csv").write_text(
        'a,b,c\n1,2\n"never closed\nmore,junk,here', encoding="utf-8"
    )
    (directory / "empty.csv").write_text("", encoding="utf-8")
    return directory
