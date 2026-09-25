"""Keeps the Render API awake: Render's free plan puts a web service to sleep
after 15 minutes without a request, and the next visitor then waits up to a
minute. This asks /api/health every couple of minutes so that never happens.

  python scripts/keep_alive.py                     # every 2 minutes, until stopped
  python scripts/keep_alive.py --count 3           # three pings, then exit (what CI runs)
  python scripts/keep_alive.py --interval 300      # every 5 minutes
  KEEPALIVE_URL=https://example.com/api/health python scripts/keep_alive.py

Standard library only, so it runs on any Python 3.9+ without installing
anything. .github/workflows/keep-alive.yml runs it on GitHub's servers, so it
keeps working when this computer is off.

Render's free plan includes 750 instance hours a month, enough for one
service awake all month (about 730 hours); a second always-on free service
would run out.
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

DEFAULT_URL = "https://freightwise-backend.onrender.com/api/health"


def ping(url: str, timeout: float) -> tuple[bool, str]:
    """One request; (ok, what happened). Never raises."""
    started = time.monotonic()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "freightwise-keep-alive"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            res.read(200)
            ok = res.status == 200
            return ok, f"HTTP {res.status} in {time.monotonic() - started:.1f}s"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code} in {time.monotonic() - started:.1f}s"
    except Exception as e:  # network down, DNS, timeout: report and keep going
        return False, f"{type(e).__name__}: {e}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=os.environ.get("KEEPALIVE_URL", DEFAULT_URL))
    parser.add_argument("--interval", type=float, default=120, help="seconds between pings (default 120)")
    parser.add_argument("--count", type=int, default=0, help="stop after this many pings (default: never)")
    # A sleeping free instance takes up to a minute to wake, so allow for it.
    parser.add_argument("--timeout", type=float, default=90, help="seconds to wait for an answer (default 90)")
    args = parser.parse_args()

    print(f"Pinging {args.url} every {args.interval:g}s" + (f", {args.count} times" if args.count else ", until stopped"), flush=True)
    failures = 0
    n = 0
    try:
        while True:
            n += 1
            ok, detail = ping(args.url, args.timeout)
            failures = 0 if ok else failures + 1
            print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {'ok  ' if ok else 'FAIL'}  {detail}", flush=True)
            if args.count and n >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("Stopped.")
    # In CI a run where every ping failed is worth a red mark; one blip isn't.
    return 1 if args.count and failures >= args.count else 0


if __name__ == "__main__":
    sys.exit(main())
