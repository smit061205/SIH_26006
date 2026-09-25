"""Reads optional reference-data fields. A column may be missing, blank, None
or NaN (pandas keeps NaN in float columns); all of those mean "not known",
and callers fall back to the behaviour that existed before the column."""
import math

import pandas as pd


def opt_value(row: pd.Series | dict | None, key: str):
    if row is None:
        return None
    value = row.get(key) if hasattr(row, "get") else None
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


def opt_float(row: pd.Series | dict | None, key: str) -> float | None:
    value = opt_value(row, key)
    return None if value is None else float(value)


def opt_int(row: pd.Series | dict | None, key: str) -> int | None:
    value = opt_value(row, key)
    return None if value is None else int(float(value))


def opt_str(row: pd.Series | dict | None, key: str) -> str | None:
    value = opt_value(row, key)
    return None if value is None else str(value).strip()
