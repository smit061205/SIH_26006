"""Stage 6: live AIS vessel tracking - INTERFACE ONLY, not implemented with
real data.

Unlike weather (src/live_weather.py, genuinely free via Open-Meteo), real
individual-vessel AIS position tracking has no equivalent free, keyless,
no-registration option:
  - MarineTraffic / VesselFinder / Datalastic APIs: paid subscription
  - AISHub: free, but requires registering a receiving station / account
    and agreeing to reciprocal data sharing - not something this session
    can self-provision (creating accounts is out of scope for an agent to
    do on a user's behalf)
  - IMF PortWatch (already integrated, see data/imf_portwatch_summary.csv):
    real and free, but reports PORT-level aggregate call counts, not
    individual vessel lat/lon positions - not a substitute for this.

So rather than fabricate fake vessel positions and present them as "live
tracking" (which would be actively misleading in a demo), this module
defines the interface FREIGHTWISE's decision engine expects, ready to wire
to a real provider once the team has credentials. Every function raises
NotImplementedError with the exact env var it needs, rather than returning
silently-fake data.
"""
import os


class AISProviderNotConfigured(RuntimeError):
    pass


def get_vessel_positions(port_ids: list[str]) -> list[dict]:
    """Expected real return shape (matching typical AIS provider responses):
    [{"mmsi": str, "vessel_name": str, "lat": float, "lon": float,
      "speed_knots": float, "heading": float, "destination_port_id": str,
      "eta": str}, ...]

    Not implemented: requires AIS_PROVIDER_API_KEY to be set to a real
    provider key (MarineTraffic, Datalastic, AISHub, etc.) and a matching
    request implementation for that provider's API shape, which differs
    provider to provider. Wire this in once the team has picked and paid
    for / registered with one.
    """
    if not os.environ.get("AIS_PROVIDER_API_KEY"):
        raise AISProviderNotConfigured(
            "No real AIS feed is configured (AIS_PROVIDER_API_KEY is unset). "
            "This is intentional - see src/live_ais.py docstring for why this "
            "can't be a free/keyless integration the way weather is. Set that "
            "env var to a real provider's key and implement the matching "
            "request/response mapping for that provider before calling this."
        )
    raise NotImplementedError("Provider-specific request logic not yet written - see docstring.")
