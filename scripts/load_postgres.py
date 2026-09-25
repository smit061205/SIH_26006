"""Loads data/*.csv into Postgres per db/schema.sql.

Usage:
    export DATABASE_URL=postgresql://freightwise:freightwise@localhost:5432/freightwise
    python3 scripts/load_postgres.py

This is a one-off/idempotent loader (drop, recreate from db/schema.sql,
re-insert), so a database created from an older schema picks up new columns.
Not a real ingestion pipeline - src/data_loader.py still reads CSVs by default, this
just proves the schema and data round-trip correctly through Postgres for
whenever the team is ready to switch the app's data layer over.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://freightwise:freightwise@localhost:5432/freightwise")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "db" / "schema.sql"

TABLE_TO_CSV = {
    "ports": "ports.csv",
    "vessel_classes": "vessel_classes.csv",
    "plants": "plants.csv",
    "cost_assumptions": "cost_assumptions.csv",
    "port_to_plant_rail": "port_to_plant_rail.csv",
    "origin_transit_days": "origin_transit_days.csv",
    "gangavaram_tariff_reference": "gangavaram_real_tariff_reference.csv",
}

# Insertion order matters: port_to_plant_rail has FKs into ports/plants.
# port_daily_activity and gangavaram_tariff_reference have no FKs, so their
# position among the rest doesn't matter - kept last as the newest additions.
LOAD_ORDER = [
    "ports",
    "vessel_classes",
    "plants",
    "cost_assumptions",
    "port_to_plant_rail",
    "origin_transit_days",
    "gangavaram_tariff_reference",
    "port_daily_activity",
    "freight_rates",
]

FREIGHT_SERIES = ("handysize", "supramax", "panamax", "capesize")

# One daily file per discharge port (scripts/fetch_portwatch.py), named as in ports.csv.
FULL_HISTORY_PORTS = {
    "dhamra": "Dhamra",
    "haldia": "Haldia",
    "paradip": "Paradip",
    "visakhapatnam": "Visakhapatnam",
    "gopalpur": "Gopalpur",
}


def _build_port_daily_activity_df() -> pd.DataFrame:
    """Daily dry-bulk calls and tonnes for every discharge port PortWatch tracks."""
    frames = []
    for slug, port_name in FULL_HISTORY_PORTS.items():
        df = pd.read_csv(DATA_DIR / f"imf_portwatch_{slug}_full_history.csv")
        df.insert(0, "port_name", port_name)
        if "export_dry_bulk" not in df.columns:
            df["export_dry_bulk"] = pd.NA
        frames.append(df)
    return pd.concat(frames, ignore_index=True)[
        ["port_name", "date", "portcalls_dry_bulk", "import_dry_bulk", "export_dry_bulk"]
    ]


def _build_freight_rates_df() -> pd.DataFrame:
    frames = [pd.read_csv(DATA_DIR / f"freight_rates_{name}.csv") for name in FREIGHT_SERIES]
    return pd.concat(frames, ignore_index=True)[["vessel_class", "date", "freight_usd_per_day", "data_confidence"]]


def main():
    engine = create_engine(DATABASE_URL)

    with engine.begin() as conn:
        for table in reversed(LOAD_ORDER):
            conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
        conn.execute(text(SCHEMA_PATH.read_text()))

    for table in LOAD_ORDER:
        if table == "port_daily_activity":
            df = _build_port_daily_activity_df()
        elif table == "freight_rates":
            df = _build_freight_rates_df()
        else:
            df = pd.read_csv(DATA_DIR / TABLE_TO_CSV[table])
        df.to_sql(table, engine, if_exists="append", index=False)
        print(f"Loaded {len(df)} rows into {table}")

    with engine.connect() as conn:
        for table in LOAD_ORDER:
            count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            print(f"  {table}: {count} rows in Postgres")


if __name__ == "__main__":
    main()
