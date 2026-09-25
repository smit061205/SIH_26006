"""Refreshes daily dry-bulk port activity from IMF PortWatch's public ArcGIS
service (no key needed), for the Indian discharge ports and the loading ports.

  Discharge ports -> data/imf_portwatch_<port>_full_history.csv
                     (date, portcalls_dry_bulk, import_dry_bulk, export_dry_bulk, month)
  Loading ports   -> data/imf_portwatch_origin_<port>.csv
                     (date, portcalls_dry_bulk, export_dry_bulk, month)

Gangavaram and Sagar-Sandheads aren't tracked separately by PortWatch.
Run from anywhere: python -m scripts.fetch_portwatch
"""
from pathlib import Path

import pandas as pd
import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
QUERY = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0/query"
START = "2019-01-01"
PAGE = 2000

# Name used in the app -> PortWatch port id
DISCHARGE_PORTS = {
    "Visakhapatnam": "port1367",
    "Paradip": "port883",
    "Haldia": "port442",
    "Dhamra": "port290",
    "Gopalpur": "port2299",
}
# Loading port (origin_transit_days.csv activity_port) -> PortWatch port id
LOADING_PORTS = {
    "Hay Point": "port458",
    "Nacala": "port784",
    "Tanjung Sangata": "port1270",
    "Norfolk": "port826",
    "Vostochny": "port1374",
    "Ust-Luga": "port1095",
}


def slug(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


def fetch(portid: str) -> pd.DataFrame:
    rows, offset = [], 0
    while True:
        params = {
            "where": f"portid='{portid}' AND date >= '{START}'",
            "outFields": "date,portcalls_dry_bulk,import_dry_bulk,export_dry_bulk",
            "orderByFields": "date",
            "returnGeometry": "false",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
            "f": "json",
        }
        resp = requests.get(QUERY, params=params, timeout=60)
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            raise RuntimeError(body["error"])
        feats = body.get("features", [])
        rows += [f["attributes"] for f in feats]
        # The service caps a page (at 1,000 rows today) and flags when more remain.
        if not feats or not body.get("exceededTransferLimit"):
            break
        offset += len(feats)
    df = pd.DataFrame(rows).drop_duplicates("date").sort_values("date")
    df["month"] = pd.to_datetime(df["date"]).dt.month
    return df


def write_summary() -> None:
    """data/imf_portwatch_summary.csv: per discharge port, history span, mean
    dry-bulk calls and imports a day, and monsoon (Jun-Sep) vs rest of year."""
    rows = []
    for name, portid in DISCHARGE_PORTS.items():
        df = pd.read_csv(DATA_DIR / f"imf_portwatch_{slug(name)}_full_history.csv", parse_dates=["date"])
        monsoon = df["date"].dt.month.isin([6, 7, 8, 9])
        m, rest = df.loc[monsoon, "portcalls_dry_bulk"].mean(), df.loc[~monsoon, "portcalls_dry_bulk"].mean()
        rows.append(
            {
                "port_name": name,
                "portwatch_portid": portid,
                "history_start": df["date"].min().strftime("%Y-%m-%d"),
                "history_end": df["date"].max().strftime("%Y-%m-%d"),
                "total_days": len(df),
                "avg_dry_bulk_calls_per_day": round(df["portcalls_dry_bulk"].mean(), 2),
                "avg_dry_bulk_import_tonnes_per_day": round(df["import_dry_bulk"].mean(), 0),
                "monsoon_jun_sep_avg_calls_per_day": round(m, 2),
                "non_monsoon_avg_calls_per_day": round(rest, 2),
                "monsoon_vs_non_monsoon_pct": round((m / rest - 1) * 100, 1) if rest else None,
                "data_confidence": f"real_verified_api_pulled_{pd.Timestamp.today():%Y-%m-%d}",
            }
        )
    pd.DataFrame(rows).to_csv(DATA_DIR / "imf_portwatch_summary.csv", index=False)


def main():
    for name, portid in DISCHARGE_PORTS.items():
        df = fetch(portid)[["date", "portcalls_dry_bulk", "import_dry_bulk", "export_dry_bulk", "month"]]
        out = DATA_DIR / f"imf_portwatch_{slug(name)}_full_history.csv"
        df.to_csv(out, index=False)
        print(f"{name}: {len(df)} days to {df['date'].iloc[-1]} -> {out.name}")
    for name, portid in LOADING_PORTS.items():
        df = fetch(portid)[["date", "portcalls_dry_bulk", "export_dry_bulk", "month"]]
        out = DATA_DIR / f"imf_portwatch_origin_{slug(name)}.csv"
        df.to_csv(out, index=False)
        print(f"{name}: {len(df)} days to {df['date'].iloc[-1]} -> {out.name}")
    write_summary()


if __name__ == "__main__":
    main()
