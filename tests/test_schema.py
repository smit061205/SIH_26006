"""db/schema.sql must keep up with the CSVs: every CSV column needs a
column in its table, or scripts/load_postgres.py fails on insert."""
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = (ROOT / "db" / "schema.sql").read_text()


def _table_columns(table: str) -> set[str]:
    body = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", SCHEMA, re.S).group(1)
    names = set()
    for line in body.splitlines():
        line = line.strip()
        if line and not line.startswith(("--", "PRIMARY KEY")):
            names.add(line.split()[0])
    return names


def test_every_csv_column_has_a_schema_column():
    from scripts.load_postgres import TABLE_TO_CSV

    for table, csv in TABLE_TO_CSV.items():
        columns = set(pd.read_csv(ROOT / "data" / csv, nrows=1).columns)
        missing = columns - _table_columns(table)
        assert not missing, f"{table}: {missing}"


def test_freight_rates_table_matches_series_files():
    from scripts.load_postgres import _build_freight_rates_df

    df = _build_freight_rates_df()
    assert set(df.columns) <= _table_columns("freight_rates")
    assert set(df["vessel_class"]) == {"Handysize", "Supramax", "Panamax", "Capesize"}
    assert not df.duplicated(["vessel_class", "date"]).any()


def test_port_activity_uses_app_port_names():
    from scripts.load_postgres import _build_port_daily_activity_df

    df = _build_port_daily_activity_df()
    ports = set(pd.read_csv(ROOT / "data" / "ports.csv")["name"])
    assert set(df["port_name"]) <= ports
    assert not df.duplicated(["port_name", "date"]).any()
