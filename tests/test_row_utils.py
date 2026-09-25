import math

import pandas as pd

from src.row_utils import opt_float, opt_int, opt_str, opt_value


def test_missing_values_read_as_none():
    row = pd.Series({"nan": math.nan, "blank": "  ", "none": None, "text": " Haldia ", "num": "12.5"})
    for key in ("nan", "blank", "none", "absent"):
        assert opt_value(row, key) is None
        assert opt_float(row, key) is None
        assert opt_str(row, key) is None
    assert opt_str(row, "text") == "Haldia"
    assert opt_float(row, "num") == 12.5
    assert opt_int(row, "num") == 12


def test_none_row_and_dict_rows():
    assert opt_value(None, "x") is None
    assert opt_float({"x": 3}, "x") == 3.0
