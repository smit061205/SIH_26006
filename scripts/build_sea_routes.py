"""Builds data/sea_routes.json: a realistic sea route and its length for every
load port and discharge port pair, for the voyage globe.

Routes come from searoute (Apache-2.0 licence), which finds the shortest path over
an offline network of real shipping lanes (the MARNET network used by
Eurostat), so routes follow Malacca, Suez and the coasts rather than cutting
across land. Run once, offline; the app only reads the JSON:

    pip install -r requirements-dev.txt
    python scripts/build_sea_routes.py

Each route is simplified to keep the file small, and its length in nautical
miles is compared with the transit estimate in data/origin_transit_days.csv;
differences over 25% are printed.
"""
import csv
import json
import math
from datetime import date
from pathlib import Path

import searoute as sr

ROOT = Path(__file__).resolve().parent.parent

# Load terminal positions (lon, lat), one per origin in origin_transit_days.csv.
LOAD_PORTS = {
    "Australia (Hay Point/Dalrymple Bay)": (149.30, -21.26),
    "Mozambique (Nacala/Beira)": (40.60, -14.53),
    "Indonesia (Kalimantan/Tanjung Bara)": (117.63, 0.55),
    "USA East Coast (Hampton Roads/Baltimore)": (-76.33, 36.87),
    "Russia Far East (Vostochny)": (133.07, 42.75),
    "Russia Baltic (Ust-Luga)": (28.40, 59.68),
}


def simplify(coords: list[list[float]], tolerance_deg: float = 0.25) -> list[list[float]]:
    """Douglas-Peucker in plain lon/lat degrees: good enough for a globe line."""
    if len(coords) < 3:
        return coords

    def dist(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == dy == 0:
            return math.hypot(x - x1, y - y1)
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        i, j = stack.pop()
        best, k = 0.0, -1
        for m in range(i + 1, j):
            d = dist(coords[m], coords[i], coords[j])
            if d > best:
                best, k = d, m
        if best > tolerance_deg and k > 0:
            keep[k] = True
            stack += [(i, k), (k, j)]
    return [[round(x, 3), round(y, 3)] for x, y in (c for c, kept in zip(coords, keep) if kept)]


def main() -> None:
    origins = {r["origin"]: r for r in csv.DictReader(open(ROOT / "data" / "origin_transit_days.csv"))}
    ports = list(csv.DictReader(open(ROOT / "data" / "ports.csv")))
    routes = []
    for origin, (lon, lat) in LOAD_PORTS.items():
        estimate = float(origins[origin]["transit_nm_est"])
        for p in ports:
            dest = (float(p["longitude"]), float(p["latitude"]))
            feature = sr.searoute((lon, lat), dest, units="naut")
            nm = float(feature["properties"]["length"])
            coords = simplify(feature["geometry"]["coordinates"])
            routes.append({"origin": origin, "port": p["name"], "nm": round(nm), "coords": coords})
            gap = (nm - estimate) / estimate
            if abs(gap) > 0.25:
                print(f"  {origin} -> {p['name']}: {nm:.0f} nm vs estimate {estimate:.0f} ({gap:+.0%})")
    # Backhaul legs for alternative employment: each discharge port to China
    # (the main iron-ore backhaul), and the ballast leg from China back to each
    # load port, plus each discharge port straight back to each load port.
    qingdao = (120.32, 36.07)
    legs = []
    for p in ports:
        here = (float(p["longitude"]), float(p["latitude"]))
        legs.append({"from": p["name"], "to": "Qingdao", "nm": round(float(sr.searoute(here, qingdao, units="naut")["properties"]["length"]))})
        for origin, point in LOAD_PORTS.items():
            legs.append({"from": p["name"], "to": origin, "nm": round(float(sr.searoute(here, point, units="naut")["properties"]["length"]))})
    for origin, point in LOAD_PORTS.items():
        legs.append({"from": "Qingdao", "to": origin, "nm": round(float(sr.searoute(qingdao, point, units="naut")["properties"]["length"]))})

    out = {
        "generated": date.today().isoformat(),
        "legs": legs,
        "source": "searoute (MARNET shipping-lane network), simplified to 0.25 degrees",
        "load_ports": {k: {"lon": v[0], "lat": v[1]} for k, v in LOAD_PORTS.items()},
        "routes": routes,
    }
    (ROOT / "data" / "sea_routes.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {len(routes)} routes to data/sea_routes.json")


if __name__ == "__main__":
    main()
