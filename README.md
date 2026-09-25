# FREIGHTWISE

Charter planning for SAIL's coking-coal imports to India's east coast. Smart
India Hackathon 2026, problem **SIH26006** (Ministry of Steel).

A planner sets one shipment: plant, coal grade, load port, cargo ± tolerance,
laycan and contract length. Freightwise then answers what the statement asks:

- which vessel type and discharge port to charter;
- when to fix, and how much to put on contract versus spot;
- what a spare ship should do (wait, sublet or carry a backhaul cargo);
- what to watch at the ports and in the market.

Each answer is costed to the plant in USD or INR.

**[docs/PROBLEM_COVERAGE.md](docs/PROBLEM_COVERAGE.md)** maps every
requirement in the problem statement to the feature and code that answers
it. It also covers the planner's workflow, why each input is asked, how firm
each data source is, and what is out of scope.

## What it does

| Page | What it answers |
|---|---|
| **Charter plan** (`/plan`) | The verdict, with four decisions: what to charter (with the fixture terms), when to fix, contract or spot (the spot alternative priced at each month's forecast), and the voyage schedule. Also what to watch, whether the plant's stock lasts until the first cargo (the planner can enter the real stock) and the voyage on a globe. |
| **Vessel & port** | Every feasible class and port, ranked by landed cost at the plant: hire, bunkers, cargo handling, port charges, waiting (berth and loading-port queues), transshipment and rail. Why a class can't use a port. Each port's unloading equipment. The five ship types in 3D. |
| **Freight outlook** | Each class's weekly time-charter forecast (ARIMA or trees with coal, oil and the rupee, whichever backtests better), the best week to fix, freight by trade route in $/t, market drivers, the contract split and forecast accuracy. |
| **Scenarios** | Idle time and how to cut it; the cost of waiting; keeping an idle ship earning (sublet, backhaul, low-demand periods); a port closed; several shipments competing for berth slots (OR-Tools CP-SAT). |
| **Ports** | Each discharge port's usable draft this month, equipment, activity against normal and the sea state ahead. The port in 3D. The loading terminals and their congestion. |
| **Developer tools** (`/kit`) | The component gallery, the 3D test bench and the disruption notices that feed the alerts. Developer accounts anywhere; open without sign-in in development builds. |

Everything is in English and Hindi, light and dark, and USD or INR, with
alerts, saved plans, print and keyboard shortcuts.

## How it's built

- **Backend** (`backend/`, FastAPI): a thin API over the planning modules in
  `src/`. It covers accounts (sessions, CSRF, rate limits, email confirmation
  and DPDP rights) and SQLite locally or Postgres in production.
- **Planning** (`src/`, plain Python and pandas):
  - feasibility, cost engine and ranking;
  - forecasts and walk-forward backtest;
  - timing, contract split and schedule;
  - route freight, employment and alerts;
  - stock cover and scenarios.
  Every figure comes from `data/*.csv`, and each row carries its source and
  confidence.
- **Frontend** (`frontend/`, React, TypeScript and Vite): TanStack Query,
  Tailwind v4 and Radix. The 3D views use three.js through React Three Fiber
  and drei, with a WebGL2 post-processing chain (see "Ships and the 3D
  world"). See `frontend/README.md` and `frontend/DESIGN.md`.
- **Tests:**
  - `pytest tests/` runs the backend tests (221);
  - `npm run check:hull` runs the geometry and data checks;
  - `npm run lint` runs oxlint;
  - `npm run build` type-checks and bundles.

The sections after "Running" record how the project got here, round by round,
including the data sources behind each CSV.

## Running

**React + FastAPI (two processes):**
```bash
# terminal 1 - backend, from the project root
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# terminal 2 - frontend
cd frontend
npm install   # first time only
npm run dev   # opens on http://localhost:5173
```

The app needs an account: open http://localhost:5173 and choose **Get
started**. Local settings live in a git-ignored `.env` file at the project
root (copy `.env.example`); the backend reads it at start-up.

- **Developer code:** with `DEVELOPER_ACCESS_CODE` set in `.env` (keep it
  private), entering it under "Have a developer code?" at sign-up gives an
  account that is ready at once, with the developer tools (`/kit`). It also
  finishes an earlier sign-up whose email was never confirmed. Signed-in
  accounts can add it on the Account page.
- **Email:** without a mail server, confirmation and reset links appear on the
  page (outside `APP_ENV=production`). To send real email through Gmail: turn
  on 2-Step Verification for the Google account, create an App Password at
  https://myaccount.google.com/apppasswords, put the address in `SMTP_USER`
  and the 16-character App Password in `SMTP_PASSWORD` in `.env`, and restart
  the backend. Gmail allows about 500 messages a day.

**First-time Python setup and tests:**
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # runtime + pytest
pytest tests/
```

**Refreshing the public data (network, no keys):**
```bash
python -m scripts.fetch_portwatch          # port activity, discharge + loading ports
python -m scripts.fetch_market_drivers     # coal, Brent, INR
python -m scripts.generate_synthetic_freight_rates
```

**Docker (both services, one command):**
```bash
docker compose up --build
# backend on http://localhost:8000, frontend on http://localhost:5173
```

**Postgres (optional, not required for the app to run):**
```bash
docker compose --profile postgres up -d postgres
DATABASE_URL=postgresql://freightwise:freightwise@localhost:5432/freightwise \
  python3 scripts/load_postgres.py
```

**Deploying:** the web app on Vercel (`frontend/vercel.json`) and the API
with its Postgres account store on Render (`render.yaml`); Vercel forwards
`/api/*` to Render so the session cookie stays first-party. Step by step in
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Project layout

```
data/            reference CSVs: ports (limits, monsoon, unloading equipment), vessel classes
                 (particulars, block coefficient, hatch covers, cranes, fuel), plants, rail,
                 cost assumptions, origins (load terminals, coal grades), backhaul lanes,
                 synthetic freight series, IMF PortWatch pulls, sea_routes.json
db/schema.sql    Postgres schema mirroring data/*.csv (optional data layer)
docs/            PROBLEM_COVERAGE.md: the statement mapped to the features
scripts/         fetch_portwatch, fetch_market_drivers, generate_synthetic_freight_rates,
                 build_sea_routes (routes and backhaul/ballast legs), load_postgres
src/
  data_loader.py     CSV loading, route distances, bunker price from Brent, loading-port queue
  feasibility.py     draft (monsoon), LOA, beam, class at both ends
  cost_engine.py     landed cost per tonne: hire, bunkers, handling, port charges, waiting, rail
  rank.py            every feasible class and port, ranked; tolerance, fixed class or port
  forecast.py        naive, seasonal naive, ARIMA, gradient-boosted trees (with market drivers)
  backtest.py        walk-forward harness, MASE and directional accuracy
  timing.py          best week to fix; fix now / wait / stagger
  scenario.py        waiting, port closed, contract split, idle time
  schedule.py        month-by-month contract plan with the spot alternative
  route_freight.py   freight per tonne by trade route, now and forecast
  employment.py      wait / sublet / backhaul for an idle ship; low-demand periods
  alerts.py          sea state, waits, busy ports (discharge and loading), rates, notices
  stock.py           plant days of cover against the arrival
  multi_shipment.py  OR-Tools CP-SAT joint assignment under berth-slot limits
  users.py, mailer.py, password_policy.py   accounts, email, password rules
  live_weather.py    Open-Meteo marine forecast (live); live_ais.py is a documented stub
backend/main.py    FastAPI over src/ (see /docs on a running backend); auth.py for accounts
frontend/src/
  pages/             CharterPlan, VesselPort, FreightOutlook, Scenarios, Ports, Account, Auth,
                     Landing, Kit (developer tools), legal pages
  components/ui/     layout, figures, table, inputs, forms, overlay, feedback, bars, alerts, drivers
  components/charts/ FreightChart ($/day or $/t), PortLoadChart, WaveStrip, ScheduleStrip,
                     Sparkline, StockMeter, MiniLine, CallsHistory
  components/ship3d/ hull.ts (geometry from particulars), parts/ (hatches, deck gear, fittings,
                     superstructure, underwater), materials.ts (PBR paint and markings),
                     Ocean, Environment (sky, clouds, HDRI light), Effects (post-processing),
                     Surroundings, PortStage, Globe, quality.ts (quality tiers)
  components/dev/    DisruptionNotices (developer tool)
  lib/               format, currency, shipment (URL state), router, queries, labels, alerts,
                     i18n + i18n-hi, theme, savedPlans
frontend/public/3d/  CC0 sky HDRIs, painted-steel/concrete/gravel PBR maps, water normals (CREDITS.md)
docker-compose.yml, render.yaml, backend/Dockerfile, frontend/Dockerfile
```

## Stage 5 — Scenario simulation + multi-shipment planning

`src/scenario.py`:
- **Wait-day tradeoff** — same (vessel, port) as the #1 recommendation, cost
  recomputed under different assumed wait times (0/3/7/14 days), so "book
  now vs wait" has real dollar figures next to it.
- **Port exclusion** — "what if the top port becomes unavailable" reruns
  the ranking with one port removed.
- **`recommend_contract_split()`** — the piece that actually converts
  Layer 2's forecast into an action (closing the exact gap flagged in the
  Stage 4 section above). Explainable rule, not a black box: starts at a
  50% contract/spot baseline, tilts toward contract when the forecast
  expects rates to rise and toward spot when it expects them to fall,
  scaled down by how wide the confidence band is (a wide band pulls the
  recommendation back toward 50%, since a big bet on an uncertain forecast
  is riskier than a small one), clipped to [20%, 80%]. Every number in the
  reasoning string is shown, not hidden.

`src/multi_shipment.py` — OR-Tools CP-SAT joint assignment:
- Single-shipment ranking picks the cheapest option per shipment
  independently. That breaks down once SAIL is booking several shipments
  in the same month, because independent argmin has no way to see that
  it's sending 5 vessels to a port whose berths can't take 5 calls in a
  month. This module jointly assigns all shipments to (vessel, port)
  options, minimizing total cost subject to a max-calls-per-port-per-month
  cap.
- **The capacity cap itself is illustrative** (no verified real berth-slot
  figure exists in this project) — the point being demonstrated is the
  optimization approach (joint assignment beats naive independent picks),
  not the specific cap number.
- **Real, verified test result**: 5 shipments, same month/origin/plant, cap
  of 2 calls/port/month → naive picking sends all 5 to Dhamra (violates the
  cap, infeasible in reality) at $5,165,000; the CP-SAT solver spreads them
  across 3 ports, respecting the cap, for $5,247,750 — **+1.6% cost for a
  plan that's actually executable**, which is the real trade-off being
  shown, not a hypothetical one.
- Exposed identically in both UIs: Streamlit's "Scenario & Multi-Shipment
  Planning" tab and React's `ScenarioPlanning.tsx` (with matching
  `/api/scenario/*` and `/api/plan` backend endpoints) — verified working
  end-to-end in both, including the live OR-Tools solve running from a
  browser click.

## Stage 6 — Docker, live weather, Postgres, deployment prep

- **Live weather** (`src/live_weather.py`) — **real, live, no-API-key**
  marine forecast via Open-Meteo (`marine-api.open-meteo.com`), for all 6
  ports' real coordinates (sourced this pass, see `data/ports.csv`'s new
  `latitude`/`longitude` columns). Not synthetic, not a placeholder — every
  call hits a real forecast service. Fetched concurrently (6 ports in
  parallel via `ThreadPoolExecutor`) after the first version was measurably
  slow (~4-8s) sequential. Exposed as `/api/weather` and a "Show live
  weather" panel in both Streamlit and React Layer 1 views.
- **Live AIS vessel tracking is explicitly NOT implemented** with real data
  (`src/live_ais.py`) — unlike weather, there's no free/keyless option
  (MarineTraffic/VesselFinder/Datalastic are paid; AISHub needs account
  registration this session can't do on the user's behalf). Rather than
  fabricate fake vessel positions and present them as "live," the module
  defines the interface FREIGHTWISE expects and raises a clear
  `AISProviderNotConfigured` error naming exactly what env var and
  provider-specific code is needed. IMF PortWatch (already integrated,
  Stage 1 real-data pass) is real and free but reports port-level
  aggregate call counts, not individual vessel positions — not a
  substitute.
- **Docker** — `backend/Dockerfile`, `frontend/Dockerfile` (multi-stage:
  Vite build → nginx), `docker-compose.yml`. **Actually built and run**,
  not just authored: `docker compose build` caught two real bugs a
  pre-populated local `.venv` was hiding — a TypeScript production-build
  error in the Recharts Tooltip formatters (dev mode doesn't type-check;
  `tsc -b` does), and `ortools` missing from `requirements.txt` entirely
  (installed directly into the dev venv earlier, never recorded). Both
  fixed, then the full containerized stack (nginx-served static frontend +
  containerized FastAPI backend) was verified end-to-end in-browser,
  computing the same correct numbers as the dev servers.
- **Postgres** (`db/schema.sql`, `scripts/load_postgres.py`) — schema
  mirroring `data/*.csv` column-for-column (including the
  `data_confidence` provenance columns). **Actually tested against a real
  Postgres container**, not just written: loaded all 6 reference tables,
  verified row counts, and ran a real join query confirming the sourced
  Paradip↔Rourkela 497km rail distance round-tripped correctly. This is
  optional infrastructure — `src/data_loader.py` still reads CSVs by
  default, since that needs zero setup for local dev; Postgres is there
  for whenever the team moves off hand-maintained flat files (e.g. to
  ingest SAIL's real booking history). Start it with
  `docker compose --profile postgres up postgres`.
- **Cloud deployment — prepared, not executed** (superseded: see `docs/DEPLOY.md`). `render.yaml` is a ready
  Render.com blueprint (Docker-based, free-tier friendly), but this
  session has no cloud credentials and **this project isn't a git repo
  yet** (no commits, no remote) — Render deploys from a connected repo, so
  there's nothing to point it at until that exists. Deploying is exactly
  the kind of action that should be user-initiated (their account, their
  billing), so this stops at "ready to deploy" rather than faking a live
  URL. See `render.yaml`'s own comments for the exact steps.

## Official problem statement

The official text is now summarised in "SIH26006 coverage round" above.
Earlier corroboration, kept for history: confirmed via a parallel team's public repo researching the same problem:
**SIH26006, Ministry of Steel, "Port-Aware Dynamic Chartering Engine (PAD-CE)"**
(github.com/Dhusyanth209/Maritime-Chartering-AI-SIH2026). Not an Anthropic/
SAIL-issued source — treat as corroboration, not an official citation, but
useful for confirming this project is scoped correctly.

## Real-time port activity data (IMF PortWatch — third pass)

Pulled directly from IMF PortWatch's live ArcGIS API
(`services9.arcgis.com/weJ1QsnbMYJlCHdG/.../Daily_Ports_Data/FeatureServer`,
the exact free/open source the deck itself names), not scraped or
copyright-restricted — this is a genuinely public API. Daily dry-bulk port
calls and import/export tonnes, **2019-01-01 through 2026-09-11**, for
Visakhapatnam, Paradip, Haldia, and Dhamra (full history saved per-port in
`data/imf_portwatch_<port>_full_history.csv`; Gopalpur only had ~3.5 months
of meaningful data; **Gangavaram is not tracked as a separate port in this
dataset at all** - it's ~15km from Visakhapatnam and may be folded into
that port's AIS footprint, or just not covered).

**Genuine finding, not assumed**: aggregate dry-bulk port-call frequency
shows **no monsoon (Jun-Sep) slowdown at any of the 4 ports checked** -
if anything it's slightly higher (+2% to +13%) than the rest of the year.
This directly informed the Vizag monsoon-reduction figure (now empirically
supported, not just "pending confirmation" - see `ports.csv`). For Dhamra,
Paradip and Haldia, I added this as a caveat on their existing
deck-sourced monsoon reduction figures **without overriding them**, because
aggregate port-call count isn't vessel-size-disaggregated in this dataset -
a real Capesize-specific draft restriction could exist even while total
port traffic (dominated by smaller vessels) stays flat. Haldia in
particular (river/tidal, siltation-prone) is the one case where I'd still
expect a real seasonal effect despite the flat aggregate number. See
`data/imf_portwatch_summary.csv` for the full per-port comparison.

## Real data integrated (across two passes)

Sourced from official port-authority / market documents, replacing prior guesses:

- **Vizag** (`ports.csv`): VGCB coal berth — LOA 300m, beam 50m, draft 18.1m.
  Source: Visakhapatnam Port Trust Marine Dept, "Allowable Drafts of Vessels"
  table (Outer Harbour). Previously a flagged placeholder; now verified.
- **Gangavaram** (`ports.csv`): **corrected** max draft from the deck's
  headline 21.0m (whole-harbour capability) down to **18.0m**, the official
  *permissible draft at the two berths (5 & 6) with priority allocation for
  Coal/Coke*. This is a real change to feasibility output — see the test
  below. Also captured the real monsoon window (1 May–30 Nov, wider than the
  generic Jun–Sep this MVP still uses globally — see gap #1). Source: Adani
  Gangavaram Port "Berthing Policy & Tariff Structure" (BPTS/AGPL/05, w.e.f.
  1 Apr 2024). **The real GT-tiered tariff (port dues, pilotage, mooring,
  dredging, sustainability charge, berth hire, lay-up hire) is now wired
  into `cost_engine.py` via `gangavaram_real_port_charges()`**, replacing
  the generic flat+per-tonne placeholder for this port specifically (the
  raw rate card is still kept in `data/gangavaram_real_tariff_reference.csv`
  for audit). The other 5 ports still use the simplified placeholder model.
- **Dhamra** (`ports.csv`): the deck's figures (18.0m draft, 290m LOA, 47m
  beam, 180,000 DWT max) were independently corroborated against Adani
  Ports' own port page and ship-technology.com — upgraded from
  `verified_from_deck` to cross-confirmed by a second, independent source.
- **Gopalpur** (`ports.csv`): upgraded from a total guess to LOA 290m, beam
  45m, draft 14.2m (Adani-operated GCB1/2/3), but flagged
  `partially_verified_conflicting_secondary_sources` since one other source
  claims a 14.5m Capesize-capable draft — Capesize is deliberately kept out
  of this port's allowed classes until that's resolved.
- **Vessel hire & demurrage rates** (`vessel_classes.csv`): Capesize
  $21,297/day hire (2025 average actual earnings) and Panamax $13,361/day are
  real reported market figures; demurrage rates ($25,000/day Capesize,
  $20,000/day Panamax) are midpoints of reported 2025 charter-party
  benchmark ranges. Handymax/Post-Panamax rates are still interpolated
  (flagged `rate_data_confidence`), not directly sourced. Demurrage is now
  per-vessel-class (it varies a lot by class in reality) instead of one
  global number.
- **Rail distances** (`port_to_plant_rail.csv`): Paradip↔Rourkela (497km)
  and Paradip↔Bokaro (573km) are real verified rail distances. Rail *cost*
  per tonne is still synthetic everywhere — Indian Railways charges coal at
  Class 145 (1.45× the Class-100 base rate per public documentation), but
  the actual paise/tonne-km base rate couldn't be confirmed from public
  sources or the FOIS freight calculator (interactive form didn't return
  usable output) in this pass.
- **Ocean transit days** (`origin_transit_days.csv`): **corrected** the
  Australia estimate from 8 days to **17 days** — the prior figure assumed
  a ~2,000nm hop that was simply wrong; the real sea route (around/through
  Australia's east coast, across the open Indian Ocean) is ~5,450-5,600 NM.
  Indonesia's estimate (9 days, ~2,900 NM) was close to the original guess
  and is now backed by the same source. NM figures cross-referenced against
  another SIH26006 team's independently published distances (see "Official
  problem statement" above) — a useful triangulation, not a primary source.
  Mozambique/USA estimates are still unsourced guesses.
- **Free laytime** (`cost_assumptions.csv`): updated from 2 to 4 days (96h),
  the more standard large-bulk-carrier charter-party allowance, again
  cross-referenced against the same external team's published assumption.

**Verified test**: Capesize is now correctly excluded at Gangavaram in July
(monsoon: 18.0m berth draft − 0.3m ≈ 17.7m usable, vessel needs 18.0m) while
still feasible in March — this is a real behavior change from the previous
placeholder data, where Gangavaram's 21.0m headline draft made Capesize
comfortably feasible year-round. Also verified: the real Gangavaram tariff
function produces materially different (higher, GT-driven) port charges than
the generic placeholder, which visibly reshuffles Gangavaram's rank in the
Streamlit output relative to the other 5 ports.

## Real rail freight rate (fifth round — user-provided)

The one ask from the "what do you need from me" list that got answered:
the user ran the **official FOIS freight calculator themselves**
(fois.indianrail.gov.in) for Paradip→Rourkela, 497km, BOXN wagon, Coking
Coal, Train Load Class 145A (the realistic mode for bulk rake shipments) —
and exported the result as a PDF. Real quote: **Rs 1149.44/tonne incl. GST
= USD 11.97/tonne** at the day's ~Rs96/USD rate. That derives a real rate
of **USD 0.02409/tonne-km**, now recorded as a sourced parameter in
`cost_assumptions.csv` and applied to extend two more rows in
`port_to_plant_rail.csv` (Paradip↔Bokaro, Paradip↔Bhilai) via their
already-real distances.

**This changed an actual output, not just a confidence label**: the old
guessed Paradip↔Rourkela rail cost was $5.80/tonne; the real figure is
$11.97/tonne — more than double. Re-running the ranking pipeline shows
Paradip drop out of the top of the recommendation list for Rourkela-bound
cargo, which it previously wasn't expected to do. This is the clearest
demonstration yet in this project that closing a data gap isn't cosmetic —
it can flip which port the tool actually recommends.

## Component library upgrade (Radix UI)

User pushed back that the app still looked "too basic" after the first
design pass and asked about external tools (Google Stitch, etc.) to close
the gap. Answer given: AI mockup generators (Stitch, Galileo AI) produce
Figma/HTML output that still needs hand-translation into our real
components; v0.dev is the one actually worth using if the user wants to
art-direct, since it outputs React+Tailwind+shadcn/ui directly - but the
higher-leverage move needed no external round-trip at all, since the
actual "basic" tell was identifiable and fixable directly: **native OS
`<select>` dropdowns and `<input type="range">` sliders**, which bypass
all custom styling and instantly read as unstyled HTML.

Installed `@radix-ui/react-select` and `@radix-ui/react-slider` (the same
unstyled-primitive layer shadcn/ui itself is built on) and rebuilt both
components from scratch in `ui.tsx`:
- **Select**: custom trigger + floating portal-rendered panel, checkmark
  on the selected item, keyboard navigation, focus ring matching the rest
  of the design system - not a native dropdown with a CSS skin on top.
- **Slider**: custom track/range/thumb rendering, draggable, with the
  current value shown in a small mono badge.

Both required an API change (`value`/`onChange(string)` +
`options: {value, label}[]` instead of native `<select>`'s children-based
API), so every call site in `Layer1.tsx` and `ScenarioPlanning.tsx` was
updated to match.

**Verified in-browser, drag-tested not just clicked**: opened the new
Select (floating panel renders correctly, checkmark shows on the current
value), selected a different plant and confirmed the ranked table
recalculated; **dragged** the new Slider's thumb (not just clicked) from
5 to 7 shipments and confirmed the OR-Tools solve re-ran live with correct
updated numbers. Zero console errors throughout.

## Streamlit removed

The original Streamlit app (`app.py`) was kept alongside React for a while
as the fast-iteration fallback — but after the design overhaul, the user
asked to remove it outright rather than maintain two UIs (one polished,
one plain). It's gone: `app.py` deleted, `streamlit` dropped from
`requirements.txt`, and `.claude/launch.json`'s Streamlit entry replaced
with a `freightwise-backend` entry (uvicorn) so both real services can
still be launched by name. **React + FastAPI is now the only frontend.**
Earlier sections of this README that describe Streamlit (Stage 3 onward)
are left as an honest build record, not rewritten — treat any "also
verified in Streamlit" note in the history below as describing what was
true at the time, not the current state.

## Accounts and privacy

Anyone with a work email can create an account; every data endpoint needs a
signed-in session (`/api/health`, `/api/auth/*` and `/api/public/*` stay open).

- **Passwords:** 8 to 128 characters with at least one capital letter, one
  number and one special character (shown as a live checklist while typing),
  paste and show/hide allowed; also rejected, as NIST SP 800-63B-4 advises, if
  on a 10,000-entry common password list (`data/common_passwords.txt`,
  SecLists) even with digits or symbols added, built from the person's name,
  email or this service, or a sequence/repeat. Stored only as salted scrypt
  hashes (N=2^17, r=8, p=1; stdlib, no extra dependency) - `src/users.py`,
  `src/password_policy.py`.
- **Sign-in** (OWASP): one generic error for a wrong email or password, the
  same timing for unknown emails, 5 failures lock the account for 15 minutes
  (doubling to 24 h), 30 attempts per 10 minutes per network. Sessions are
  random tokens stored as SHA-256 hashes in an HttpOnly, SameSite=Lax cookie
  (12 h idle, 30 days with "keep me signed in"), rotated on sign-in and revoked
  on password change or reset. State-changing requests need an
  `X-Requested-With: freightwise` header (CSRF).
- **Email:** confirmation (24 h) and reset (30 min) links are single-use.
  Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` to
  send real mail (Gmail steps under Running); mail goes out on a worker thread
  and failures are logged, never shown as an error. Without mail the links go
  to the log and, outside production, to the page (`DEV_SHOW_EMAIL_LINKS=0/1`
  overrides).
- **Sign-up asks for little** (research: every extra field costs sign-ups;
  confirm-password fields don't help; show rules up front): name, email and
  password, plus optional organisation, role and plant (the plant becomes the
  plan's default). Sign-in and sign-up are two tabs on one page (`/login`,
  `/signup`).
- **Developer accounts:** `DEVELOPER_ACCESS_CODE` (compared in constant time,
  wrong guesses count toward the per-network limit). A developer account is
  confirmed at once and can open `/kit` in any build; a confirmed account is
  never taken over by the code.
- **Deploying:** behind the Vercel rewrite the API shares the app's origin,
  so `COOKIE_SECURE=1` with the default `COOKIE_SAMESITE=lax` is enough (see
  `docs/DEPLOY.md`). Only if the API is called on its own domain does it need
  `COOKIE_SAMESITE=none` and the app's origin in `ALLOWED_ORIGINS`.
  `AUTH_DB_URL` moves the account store off the default SQLite file
  (`backend/var/app.db`).
- **DPDP Act 2023 / Rules 2025:** an itemised consent notice before sign-up
  with separate, unticked boxes for the privacy notice and terms; the Account
  page lets people correct their profile, see and end sessions, download
  everything held about them (JSON) and delete the account, which withdraws
  consent. Sign-in records are kept 180 days. The privacy notice and terms
  (`/privacy`, `/terms`) have placeholders for the operator's name, address
  and grievance officer, to fill in before a real launch.

## Landing page

`/` for visitors (signed-in people go straight to the Charter plan), always in
the light theme:

- **Hero:** the pitch, and a live panel of every discharge port's wave
  forecast for the next five days and its dry-bulk calls against usual
  (`/api/public/ports`: Open-Meteo and IMF PortWatch).
- The public sources, and what the planner covers (live counts from
  `/api/public/summary`).
- The problem, then **every feature** as a card with a small drawing: the
  charter plan, freight forecast, freight by trade route, contract or spot,
  live vessel traffic, ships in 3D, early warnings, vessel and port fit,
  keeping an idle ship earning, plant stock, several shipments together, the
  voyage globe, and the desk features (Hindi, INR, save, compare, print).
- **Spotlights:** an interactive 3D Supramax (whole ship, bow, bridge, below
  the waterline), the live AIS map (click to use it, so the page still
  scrolls), and the globe of every sea route.
- How it works, where the figures come from, security, an FAQ and a closing
  call to action.

The freight-rate levels are deliberately **not** shown there: the series are
synthetic (see above), so the public page doesn't present them as market data.

## Ships and the 3D world

Every vessel type is built in code from its particulars in
`data/vessel_classes.csv`, with no downloaded or AI-generated ship models, and
drawn to the detail of a real bulk carrier (`frontend/src/components/ship3d`).

**Hull** (`hull.ts`, plain maths):
- A parallel middle body with a flat bottom and round bilge.
- A raked, flared bow with a bulbous bow.
- An aft run into the shaft boss, the counter and a flat transom.
- Sheer, forecastle and camber.
- Each class's **block coefficient** (0.80 Handysize to 0.87 Capesize) sets
  its entrance and run, so a Capesize carries a longer parallel body.

**What sets each class apart** (from the data):
- **Handysize and Supramax are geared:**
  - four deck cranes (30 t and 35 t SWL, painted on the jibs) with their luffing tackle;
  - clamshell grabs stowed by each pedestal;
  - **hydraulic folding hatch covers** (four panels, hinge knuckles, lifting cylinders).
- **Panamax, Post-Panamax and Capesize are gearless:**
  - **side-rolling covers** on wheels;
  - rails across the deck to the outboard stowage platforms.
- Accommodation tiers, funnel and fittings scale with the ship.
- Alongside a berth, the covers open (folded up at the hatch ends, or rolled
  onto their platforms), the coal shows in the holds and the cranes work.

**Fittings** (`parts/`):
- windlasses, anchors, mooring winches and Panama fairleads;
- air pipes and mushroom vents on the holds;
- railings and bulwarks;
- the free-fall lifeboat, a rescue boat on its davit, liferafts, lifebuoys and the provision crane;
- accommodation ladders stowed along the side and pilot-ladder reels;
- the radar mast with turning scanners, satellite domes and whistle;
- the Indian civil ensign on the stern staff;
- bronze propeller, rudder and bilge keels;
- navigation lights (masthead, red to port, green to starboard, stern) and deck floodlights, which light up at dusk.

**Paint and markings** (`materials.ts`):
- Marine colours: dark topsides, red antifouling split at the summer load
  line, green deck, oxide-red covers, white superstructure.
- A CC0 painted-steel PBR scan applied tri-planar (chips, dents, rust spots,
  roughness). It is fixed to each part, so it doesn't slide as the ship rolls.
- The shader draws:
  - metric draft marks and the load line mark;
  - the name on each bow, and on the transom over the port of registry;
  - welded plating seams (strakes and butts, as a fine bump);
  - rust run-off from the hawse pipes and scuppers;
  - weed at the waterline.

**Sea and sky** (`Ocean.tsx`, `Environment.tsx`, `waves.ts`):
- Gerstner waves sized from the port's forecast wave height; the ship heaves,
  pitches and rolls on the same waves.
- A scanned water-normal map adds fine ripples at three scales.
- **Planar reflections** of the sky, clouds and ships, with a Fresnel falloff.
- Foam on crests and round each hull, thickest at the bow.
- A Preetham sky with a drifting, sun-lit **cloud layer**.
- **Image-based light** from a CC0 sky photograph, turned so its sun lines up
  with the scene's.
- Three moods: afternoon (light theme), golden hour (landing page) and dusk
  (dark theme, with lit cabin windows and blooming navigation lights).

**Surroundings** (`Surroundings.tsx`, `PortStage.tsx`):
- **At sea:** ships on the horizon, a hazy coastline and gulls.
- **In port:**
  - the quay (concrete PBR);
  - the port's own unloading machines from `ports.csv`: grab ship unloaders,
    Liebherr-type mobile harbour cranes, or floating cranes with a barge at
    Sagar-Sandheads, as many as the port has, up to one per hatch pair;
  - conveyors, stockpiles (gravel PBR) and a stacker-reclaimer;
  - a rail siding with BOXN wagons and a locomotive;
  - floodlight towers and terminal buildings;
  - a breakwater with a blinking lighthouse, channel buoys, tugs and the pilot boat;
  - the seabed at this month's usable depth, with the gap under the keel measured.
- **On the globe:** city lights in the dark theme.

**Rendering pipeline** (`SharedCanvas.tsx`, `post.ts`, `quality.ts`):
- **One WebGL context per page.** Every 3D view on a page registers a slot
  (`slots.ts`); a single fixed canvas renders each slot's own scene and camera
  into an off-screen image and copies it into that view's box, clipped under
  the sticky header. Pointer events reach the view under the pointer only.
- **A frame governor** instead of a render loop per view: a view draws at
  60 fps only while it's moving (a drag, a zoom, a camera move), at 30 fps
  (24 on Low) when its sea or flag is animated, once when it's still, and not
  at all off screen or in a background tab. That is what keeps laptops cool.
- Per view, a WebGL2 half-float post-processing chain:
  - N8AO ambient occlusion (High; off below the waterline);
  - bloom on anything brighter than white, at half resolution;
  - AgX tone mapping with a little colour and contrast back;
  - SMAA and a light vignette.
- **Quality tiers** start at High on desktops (on battery too) and step down
  only after sustained dropped frames. The viewer can also pick them under
  Display, "3D quality":
  - **High:** occlusion, half-resolution reflections, 2048 shadows, 1.5× pixels.
  - **Medium:** a third-resolution reflection, 1024 shadows, 1.25×.
  - **Low:** no reflections, bloom, occlusion or clouds, 1×.
- **Below the waterline, everywhere:** any ship view can orbit under the sea
  (and has a "Below the waterline" viewpoint): blue-green haze, drifting
  particles, caustics on the hull and seabed, and the surface seen from below.

**The globe** (`Globe.tsx`): NASA Blue Marble by day with relief and the
sun's glint on the sea, Black Marble city lights on the night side, drifting
clouds with their shadows, and an atmosphere glowing round the limb, lit from
over the viewer's shoulder. Routes are slender lines along the real shipping
lanes in a soft glow (max-blended, so shared lanes don't pile up), with light
running towards the discharge port.

**Performance and access:**
- three.js and post-processing load in one lazy chunk, only with a 3D view.
- The wheel, pinch and +/- zoom work everywhere except the landing page,
  where the wheel keeps scrolling and the +/- buttons zoom.
- Every 3D view carries a text description for screen readers; the zoom
  buttons stay reachable.
- Phones, print and browsers without WebGL get to-scale SVG drawings and a flat map.
- Assets (`frontend/public/3d/`, CC0, NASA public domain and MIT) are
  listed with sources in `CREDITS.md` there.

**Where the port scene shows:** Ports (its own "in 3D" section, with the
port's published limits until the shipment's own check is in), the Charter
plan ("At sea" or at the recommended port) and the Vessel & port close-up
("At the port").

`npm run check:hull` checks:
- dimensions, the bulb, sheer and stern, and outward faces;
- the load rule, the sea state and the sea routes;
- that the model's fullness rises with block coefficient;
- the hatch-cover type per class, grabs per crane and the sidelight sides;
- that the sample classes in the component kit match the CSV.

## Problem-statement completion and 3D upgrade round

After a second, closer reading of SIH26006 (see `docs/PROBLEM_COVERAGE.md`):

- **Cargo-handling capability:**
  - each port's unloading equipment is sourced in `ports.csv`;
  - geared ships add their own cranes' rate at mobile-crane and floating-crane ports;
  - the equipment shows on Vessel & port and Ports.
- **Freight by trade route:** `$/t` per route now and at 4, 12 and 26 weeks,
  with a weekly history and forecast chart. Transit is now per route (sea-route
  distance at 13.5 knots) instead of per origin.
- **Economic indicators in the forecast:** each class uses the better of ARIMA
  and trees with coal, Brent and the rupee, by backtest MASE, and the page
  names the model. Bunkers now enter the landed cost (VLSFO from Brent).
- **Alternative employment** for idle ships:
  - wait, sublet (less 3.75% commission) or backhaul (east-coast iron ore to
    Qingdao, then ballast to the load port);
  - low-demand periods: stock above buffer, monsoon months and strong-market weeks.
- **Loading-port congestion:** the queue at the origin (PortWatch activity)
  counts in lead time and hire. Loading-port alerts appear on the plan and on Ports.
- **Disruption notices:** developers enter them in the app (Developer tools,
  "Disruption notices"), and they raise alerts alongside the data file.
- **Fixture terms as inputs:**
  - coal grade (narrows the load ports);
  - laycan dates;
  - quantity tolerance (MOLOO);
  - a fixed vessel type or port;
  - the plant's actual stock, saved per user.
  All are in the URL and saved plans.
- **Contract months at the forecast spot rate** alongside today's fixed rate.
- **3D upgrade:** see "Ships and the 3D world".
- **Developer tools:**
  - the component kit shows every component and state with sample data;
  - alerts are sandboxed (they no longer overwrite the viewer's thresholds);
  - a guarded 3D bench covers every class, sky, sea, view, load, quality and
    port-equipment type.
- **Site sweep:**
  - reset links are hidden unless `APP_ENV=development`;
  - email sending is rate-limited, and Render has the cookie, URL and database settings;
  - a backend outage no longer sends signed-in people to sign-in;
  - validation errors read as sentences;
  - table rows have real buttons;
  - screen-reader names and the charts are translated;
  - anchors wait for their section, and changing a setting keeps the `#section`;
  - one alert count everywhere;
  - Figure values wrap on phones;
  - dead code is removed;
  - Hindi covers every new string.

## Sea routes

`scripts/build_sea_routes.py` (dev dependency `searoute`, Apache-2.0) finds
each load-port-to-discharge-port route over the MARNET shipping-lane network
and writes `data/sea_routes.json` (42 routes, simplified to ~0.25 degrees). It
is served by `/api/public/routes` (all, for the landing globe) and
`/api/routes?origin=&port=` (one, with the planning transit days). Route
lengths against the transit estimates in `data/origin_transit_days.csv`:

| Origin | Estimate (nm) | Routes (nm) |
|---|---|---|
| Australia (Hay Point) | 5,450 | 4,899-5,007 |
| Mozambique (Nacala) | 3,800 | 3,625-3,948 |
| Indonesia (Tanjung Bara) | 2,900 | 2,740-2,848 |
| USA East Coast | 12,094 | 9,659-9,982 via Suez |
| Russia Far East (Vostochny) | 4,600 | 4,612-4,720 |
| Russia Baltic (Ust-Luga) | 9,070 | 8,854-9,177 |

All are within 25% of the estimates. The Suez route from the USA is ~19%
shorter than its estimate (a Baltimore-Chennai figure), which looks like a
voyage via the Cape of Good Hope; transit days still come from the estimates.

## Audit and completion round

A full audit of the frontend and backend, then the rest of the roadmap, built
in phases. Decided with the team: landed cost uses today's market hire rate;
ships are on time charter (waiting is paid as hire, no demurrage); ships may
call part-loaded where the water is shallow; the Capesize series is
re-anchored to the real index; alerts are grouped and collapsed.

**Cost model and data (backend)**
- **One hire rate everywhere.** Landed cost used fixed 2025 averages while the
  freight outlook used the market series (7–88% higher). Hire is now the
  latest weekly market rate for the class (`data_loader.load_vessel_classes`
  adds `market_hire_rate_usd_per_day`; Post-Panamax = Panamax index × 1.08,
  `series_premium`). The Charter plan's hire per voyage now equals its
  contract-cost rows exactly (tested).
- **Time charter.** Waiting was charged twice (hire and demurrage). Now idle
  days cost hire only, shown as "Waiting time (hire)".
- **Part-loaded ships.** A ship may sail with less cargo where the draft is
  short (tonnes-per-cm immersion, `tpc_t_per_cm`) as long as it lifts at least
  half a cargo, at both the loading and discharge ends. Haldia, which no ship
  could reach, now takes part-loaded Handysize and Supramax; monsoon draft
  cuts part-load rather than exclude.
- **Seasonal swell.** Each port has typical days lost to swell in its monsoon
  months (`weather_delay_days_monsoon`), counted in landed cost and idle time.
  Idle time uses the live wave forecast only when the ship would arrive inside
  it; shifting a month out of the monsoon now shows real savings.
- **Consistent recommendation.** For a contract the Charter plan recommends the
  class that is cheapest over every month; it now says so, compares "next best"
  over the whole contract (never cheaper than the pick), and names the cheapest
  single-month option when it differs.
- **Freight series.** Seasonality fixed (was peaking in April; now Oct–Jan
  firm, Jun–Aug soft), every series ends on its real 22 Sep 2026 index level
  (BCI 53,441, BPI 20,687, BSI 22,443, BHSI 17,947) and matches the published
  2025 averages, data runs to 20 Sep 2026.
- **Errors and robustness.** Unknown origin, plant, port or vessel class → 400
  everywhere; infeasible multi-shipment plans report a status and reason
  instead of $0; contract-split and backtest inputs are bounded; weather status
  is live/partial/unavailable and failed fetches aren't cached for 30 minutes;
  CSV loads are cached by file time; one ARIMA fit per series is sliced for
  every horizon; CORS origins come from `ALLOWED_ORIGINS`.
- **Data fixes.** Gopalpur's monsoon is 1 May–30 Oct (operator's tariff);
  closing Haldia also closes Sagar-Sandheads, which transships into it;
  anchorage transloading no longer adds a second handling charge. The 8 rail
  links that were placeholders (about half the plausible cost) are now
  estimated from straight-line distance × the median rail circuity (1.373) of
  the 16 sourced routes, at the real FOIS rate — marked `ESTIMATED` in the CSV.
- **Postgres and Docker.** Schema and loader cover every new column and a
  `freight_rates` table for all four series; the loader drops and recreates
  tables so an old database picks up new columns. Python 3.13 image with
  scripts and schema; pinned `requirements.txt`, test tools in
  `requirements-dev.txt`.

**Alerts and interface**
- **Alerts take a few lines, not a page.** Grouped by type, worst first, one
  line each ("Rough sea at 6 ports: Sagar-Sandheads 4.2 m · Paradip 4.1 m · +4
  more"), three lines on the Charter plan with "Show all". Settings moved to a
  small popover. On Ports the list is gone: a one-line summary above the table
  and flags under each port's name. The top-bar count matches the Watch out
  block and no longer triggers a charter-plan request on every page.
- **Frontend fixes.** Consistent names ("Shipment total", "recommended");
  spot mode has no contract split; "Fix now" never rings a best week; split
  percentages always add to 100; schedule notes and months with no option are
  shown; phone layouts for the idle table and vessel selector; route changes
  move focus to the new page's heading; anchored links (the alert count,
  "How the split is worked out") land below the sticky header.
- **Market drivers.** Coal (Australian, monthly), Brent and the rupee from FRED
  (`scripts/fetch_market_drivers.py` → `data/market_drivers.csv`, real public
  data), shown on Freight outlook with a sentence on what they mean, and on the
  Charter plan when coal or oil moved 10% in three months. A tree model with
  these drivers is in the model comparison; it beats plain trees but not ARIMA
  on the synthetic series, so ARIMA stays the forecast.
- **Port traffic.** Weekly dry-bulk calls, 1–5 years, for every port on Ports
  (`/api/ports/{name}/history`), refreshed to 18 Sep 2026 from IMF PortWatch
  (`scripts/fetch_portwatch.py`, now with Gopalpur's full history).
- **Loading-port congestion.** PortWatch activity for Hay Point, Nacala,
  Tanjung Sangata (KPC), Norfolk, Vostochny and Ust-Luga; a surge at your
  loading port is an alert, and Ports has a "Loading ports" table.
- **Berth capacity from traffic.** Scenarios can scale berth slots to each
  port's busy-month dry-bulk calls instead of one number for all.
- **Disruption notices.** Optional `data/disruption_notices.csv` (empty until
  someone records one) feeds alerts.
- **Dark theme** per the spec in `frontend/DESIGN.md`, chart colours validated
  for the dark surface; System / Light / Dark in a "Display" menu.
- **Print** a one-page plan memo (Charter plan → Print plan).
- **Saved plans** in the browser, reopened in one click, and compared side by
  side with the current plan.
- **Keyboard shortcuts**: g then c / v / f / s / p to switch pages; ? lists them.
- **Hindi.** English/हिन्दी in the Display menu covers the interface text,
  sentences, dates and alerts; port, plant and vessel names stay in English.
  The translation is machine-assisted and needs a native speaker's review.

**Still open:** real Baltic Exchange rates (paid), live AIS (needs a key),
cloud deployment (needs a git repo and account), LightGBM (needs libomp),
backhaul trading, published port tariffs for the five ports without one, exact
FOIS quotes for the 8 estimated rail links.

## SIH26006 coverage round

Built after reading the official problem statement (mirrored in
github.com/NoBugNinja/Smart-India-Hackathon-SIH-2026-Problem-Statements,
`README_DETAILED.md`): Ministry of Steel / SAIL, "Development of an
Intelligent Freight Forecasting Model for Optimized Vessel Chartering and
Bulk Cargo Procurement from overseas to East Coast of India". It names five
origins (Australia, US, Mozambique, Russia, Indonesia), seven discharge ports
(Paradip, Vizag, Gangavaram, Gopalpur, Dhamra, Sagar-Sandheads, Haldia), four
vessel types (Handysize, Supramax, Panamax, Capesize), four recommendations
(market-entry timing, vessel type for cargo volume and port limits at both
ends, idle-time management, risk early warnings), a dashboard with contract
duration as an input, and the goal of moving from single spot fixtures to
short/medium-term multi-voyage contracts.

**Correctness fix.** The ranking never compared cargo size to ship capacity,
so 180,000 t was "best" on a 60,000 t ship. Cargo is now split into voyages:
payload = DWT max × 0.95 (`cargo_intake_utilisation`), voyages = ceil(cargo /
payload); hire, demurrage and per-call port charges are paid per voyage,
cargo handling, transshipment and rail per tonne. Berth and loading days come
from handling rates.

**Coverage of the statement**

| Requirement | Where |
|---|---|
| Vessel types as named | Handysize (new), Supramax (was Handymax), Panamax, Post-Panamax, Capesize |
| Load-port limits and handling rates | `origin_transit_days.csv` load terminal draft/LOA/beam/DWT and load rate; `feasibility.check_load_port` |
| Port-specific seasonality | `ports.csv` monsoon start/end month per port (Gangavaram May–Nov, Dhamra May–Sep, …) |
| Sagar-Sandheads, Russia | Anchorage with transshipment to Haldia and rail from Haldia (closed Jun–Sep); Vostochny and Ust-Luga origins |
| (a) Market-entry timing | `src/timing.py`: best week to fix, fix now / wait / stagger signal; `/api/timing` |
| Forecasts by vessel size | Per-class freight series (`freight_rates_{handysize,supramax,panamax}.csv`); `/api/forecast?vessel_class=` |
| (b) Vessel type for cargo and ports | Voyage-aware ranking; "best option for each vessel type" on Vessel & port |
| (c) Idle-time management | `scenario.idle_time_analysis`: idle days and cost, and other ports, classes or months that cut them; `/api/scenario/idle` |
| (d) Early warnings | `src/alerts.py`: sea state, berth waits, activity vs the previous year, freight range and moves; thresholds adjustable; `/api/alerts` |
| Contract duration, multi-voyage plan | Contract input (spot, 3, 6, 12 months); `src/schedule.py` month-by-month plan with one vessel class held; `/api/schedule` |
| Supply-chain reliability | `src/stock.py`: plant days of cover vs target and vs arrival time; `/api/plants` |
| One-screen answer | `POST /api/charter-plan` and the new Charter plan home page |

**Frontend.** Five pages in decision order: Charter plan (new home: verdict,
what to charter, when to fix, contract or spot, voyage schedule, alerts,
plant stock), Vessel & port (was Nomination; `/nomination` redirects),
Freight outlook (vessel-type selector, timing verdict, best week marked),
Scenarios (idle time first), Ports (alerts, 7 ports, activity vs normal).
The shipment bar follows the order a manager thinks in: plant, load port,
cargo per month, start month, contract. The top bar shows the alert count.

**Data added this round** (each row carries a source note and confidence in
its CSV): discharge rates and monsoon windows for all ports; Sagar-Sandheads
(depth, anchorage transloading at an estimated $7.5/t, 2 days); load-terminal
limits for Hay Point/DBCT, Nacala, Tanjung Bara, Lamberts Point, Vostochny and
Ust-Luga; Handysize and Supramax specs and hire; per-class synthetic freight
series anchored to the 22 Sep 2026 Baltic indices (BPI 20,687, BSI 22,443,
BHSI 17,947). The Capesize series is unchanged (seed 42), so earlier results
reproduce.

**Not in this round** (all added in the "Problem-statement completion" round
below): economic indicators and commodity prices, congestion at origin ports,
backhaul / alternative employment. The Capesize synthetic series
ends well below the real BCI ($53,441 on 22 Sep 2026); re-anchoring it would
change every Capesize result, so it is left as a follow-up.

## Frontend redesign: light "analyst report"

Superseded for page structure by the SIH26006 coverage round above (five
pages, Charter plan as home); the visual design still applies. Supersedes the
two design sections below, which are kept as history. The
whole frontend was rebuilt so it reads as a chartering-desk tool rather than
a generated dashboard. Full spec and the dark-theme roadmap: `frontend/DESIGN.md`.

- **Four pages with URLs**: Nomination (Layer 1), Freight outlook (Layer 2,
  now owns the contract-vs-spot decision), Scenarios (waiting, port closure,
  multi-shipment), Ports (specs, usable draft this month, sea state, live
  traffic). Port closure is new UI for the existing `/api/scenario/exclude-port`.
- **One shared shipment bar** (cargo, month, load port, plant) instead of
  duplicated forms; every input lives in the query string, so any view can be
  shared as a link.
- **USD / INR toggle** on every figure, using the live ECB rate via
  Frankfurter (fallback ₹96.00), with INR in lakh/crore.
- **Design system**: warm paper background, one navy accent for interaction,
  signal orange only for "the answer"; Source Serif 4 for titles and verdicts,
  Source Sans 3 (tabular figures) for everything else; chart palette validated
  with the dataviz script. Removed glows, gradients, shadowed cards, KPI tiles
  with icons, pill badges, count-up numbers and page animations.
- **No data caveats in the UI** (decided with the team). Provenance stays in
  this README and each CSV's `data_confidence` column.
- **Engineering**: react-query caching with stale-while-revalidate, a page
  error boundary, a backend-unreachable banner, lazy-loaded pages (chart
  library loads only on Freight outlook), responsive down to 375px.

## Full design overhaul (React only)

User asked for a full visual/interactive overhaul ("too basic," wants it
"interactive and beautiful") and specifically asked, before starting,
whether any plugins were needed to avoid a generic "AI-generated" look.
Answer: no Figma-style plugins - loaded the `dataviz` skill instead, which
supplies a validated, CVD-safe color methodology and an anti-patterns
checklist (dual-axis charts, rainbow sequential scales, thick saturated
chart blocks, dashed gridlines, etc. - checked against and avoided).

**Design system** (deliberately not generic Tailwind-blue-to-purple):
- **Color**: ocean blue (`#2f7de0` family) + steel orange (`#d9691f`
  family) as the accent pair - thematically real for FREIGHTWISE
  (shipping + steel/coal), not decorative. Chart categorical colors pulled
  from the dataviz skill's own validated dark-mode palette in fixed order
  (blue, orange, aqua, yellow, magenta), never cycled or reassigned on
  filter. Status colors (good/warning/critical) kept separate from
  categorical, per the skill's rule.
- **Typography**: IBM Plex Sans + IBM Plex Mono (self-hosted via
  `@fontsource`, not a CDN link) instead of the generic Inter/system-ui
  every AI-generated UI defaults to - IBM Plex was literally designed for
  engineering/industrial contexts, which fits an operational decision
  tool. Mono reserved for numbers that need to align (tables); large
  standalone numbers (stat tiles) stay proportional, per the skill's own
  anti-pattern warning against tabular-nums on hero figures.
- **Layout**: rebuilt from top pill-tabs into a persistent left sidebar
  app shell (`App.tsx`) with an animated active-tab indicator
  (`layoutId` spring animation via Framer Motion) and animated page
  transitions between tabs.
- **Components**: extracted a shared primitives file
  (`frontend/src/components/ui.tsx` - Card, Table, Banner, Collapsible,
  Field, AnimatedNumber, Slider, StatTile, Spinner, Skeleton) so all three
  pages share one visual language instead of each hand-rolling its own.
- **Charts**: rebuilt against the dataviz skill's anti-patterns list -
  hairline solid gridlines (not dashed), thin bars/lines, a legend always
  present, hover tooltips styled to match the app, animated entrance.

**Animations** (Framer Motion): sidebar active-item indicator, page-switch
transitions, banner entrance, collapsible section expand/collapse, a
count-up animation on dollar figures when the underlying data changes
(`AnimatedNumber` in `ui.tsx`), chart bar/line entrance animation.

**On real-time ships specifically** - unchanged from the earlier AIS
discussion: no live vessel tracking without a paid/registered provider key
(`src/live_ais.py` still an honest stub). What got built instead: a
CSS/JS-animated dashed line + moving dot from a fixed offshore point to
whichever port is currently top-ranked in Layer 1, explicitly labeled in
the UI and in a caption as "illustrative voyage animation, not live AIS" -
so it reads as motion design, not a fabricated live feed.

**A real bug this pass caught and fixed**: the first version of the new
sidebar wasn't pinned - `position: sticky` was missing, so on any page
with content taller than the viewport (all three tabs), the sidebar
scrolled away with the content instead of staying put. Found by actually
scrolling the running app in-browser, not by reading the code. Fixed with
`sticky top-0 h-screen` on the aside.

**Verified in-browser, not just built**: `tsc -b` clean after every file,
full production build clean, then walked all three tabs end-to-end in a
real browser at desktop width - sidebar navigation with spring-animated
indicator, map with working popups and the illustrative voyage dot
actually moving between screenshots (confirmed the animation loop runs),
collapsible sections opening/closing with the live-weather fetch flow,
chart tooltips, row selection, and the multi-shipment sliders
live-recalculating - zero console errors throughout.

**Not done in this pass**: Streamlit still has the old plain styling (the
overhaul was explicitly scoped to "the frontend," and Streamlit's
`app.py` was described earlier as the fast-iteration fallback, not the
primary demo surface) - both stay in sync functionally, but only React
got the visual pass.

## Interactive port map (React only)

Built the 2D map recommended earlier when the user asked about 3D ships on
a map (see that discussion — 3D was explicitly turned down as high-effort/
low-signal; a 2D map was recommended instead since it's literally in the
deck's own tech list). Now live in Layer 1: `frontend/src/components/
PortMap.tsx` using `react-leaflet` + OpenStreetMap tiles, backed by a new
`/api/ports/map` endpoint (`backend/main.py`).

- All 6 ports plotted at their real coordinates, colored by the same
  wait-day figures the ranked table already uses (green ≤3 days, amber
  4-5, red >5) - deliberately the SAME metric as the table, not a second,
  possibly-conflicting signal.
- Popups show real port data (draft, vessel classes, wait range) plus,
  where available, the real IMF PortWatch dry-bulk-calls/day figure
  (Stage 1's real-data pull) - shown as additional context, not used to
  drive the marker color, because "more port calls" doesn't unambiguously
  mean "more congested" without more interpretation than this project has
  done, and folding it into color would overstate what's actually known.
- Used `CircleMarker` instead of Leaflet's default `Marker` icon - a
  well-known Vite/Leaflet bundling issue breaks the default marker image
  path, so this sidesteps it entirely rather than patching around it.
- Verified in-browser: real map tiles load, all 6 markers render at
  correct positions, popup shows correct real data on click, zero console
  errors, and confirmed the rest of the app (Layer 2, Scenario tab) still
  works unaffected by the change.
- (Historical: Streamlit has since been removed.) The map was built React-only,
  since that's what was asked for. Streamlit's own tech list already
  named Folium for this (`st_folium`/`streamlit-folium`), so porting it
  there later is straightforward if wanted, just not done in this pass.

## Sixth round — rail distances for the rest of the grid

Followed through on "the rate is solid, distances are just geography lookups"
from above. Found real (indiarailinfo.com "shortest rail route" figures) or
moderate-confidence (single-source, not cross-confirmed) distances for 18
more of the remaining 27 pairs, applied the real $0.02409/tonne-km rate to
all of them:

- **Visakhapatnam → all 5 plants: fully real**, and not even a proxy — VSKP
  is literally Visakhapatnam Junction. (Caught and fixed a real bug here:
  first pass applied these distances to Gangavaram, correctly treated as a
  nearby-port proxy, but forgot to also apply them to the actual
  Visakhapatnam port rows.)
- **Gangavaram → all 5 plants**: same VSKP distances, used as a proxy
  (Gangavaram is ~15km from Vizag, not its own rail junction).
- **Dhamra → 4 of 5 plants** (Rourkela real via Bhadrak junction; Durgapur,
  Bokaro, Burnpur moderate-confidence single-source).
- **Haldia → 2 of 5 plants** (Durgapur, Burnpur real via indiarailinfo).
- **Gopalpur → 2 of 5 plants** (Rourkela, Burnpur moderate-confidence via
  Berhampur junction — these specific routes had the noisiest search
  results of the whole batch, conflicting figures spanning 2x, so treated
  with lower confidence than the Vizag/Haldia rows).

**Deliberately left synthetic rather than forced**: Dhamra↔Bhilai,
Haldia↔Bhilai/Rourkela/Bokaro, Gopalpur↔Bhilai/Durgapur/Bokaro, Paradip↔
Durgapur/Burnpur (9 pairs) — searches for these returned either nothing
usable or wildly conflicting numbers (e.g. one Berhampur-Durgapur search
returned values from 496km to 770km across sources). Rather than pick one
and present it as real, these stay flagged `synthetic_placeholder`.

**Net result: 21 of 30 port-plant pairs now have real or derived-from-real
rail costs** (up from 3), and — again — this changed actual
recommendations, not just confidence labels: e.g. Rourkela plant's best
option moved from $10.71/t to $16.10/t as Dhamra's real (larger) distance
replaced its placeholder.

## Data-gap-closing pass (fourth round)

User asked directly "kill the data gap" — this pass split work into what's
self-serve (retry with different tools/sources) vs what genuinely needs
something from the user (paid data, accounts, credentials). Self-serve
results:

- **Gopalpur draft conflict RESOLVED, not just upgraded.** Root cause
  found: `gopalpurports.in`/`.com` both currently resolve to an
  unconfigured default hosting panel (verified by navigating there in a
  real browser) — that's why every earlier fetch attempt failed, the site
  simply isn't live right now, not a blocking/anti-bot issue. The real
  source is Adani (current operator)'s own official BPTS document
  (BPTS/GPL/00, w.e.f. 15-Feb-2025): 3 berths, B-2 explicitly has
  **priority for import coal**, real draft **14.5m** (not the 14.2m
  previously used). This is a genuine correction, not just a confidence
  upgrade: **Post-Panamax (15.0m draft) was wrongly marked feasible here
  before and has been removed** — it doesn't fit under the real 14.5m cap.
  Real monsoon window found too: 1-May to 30-Oct (port-specific, not the
  same as Gangavaram's).
- **Paradip corrected, same pattern as Gangavaram's earlier fix.** The
  17.1m figure was a generic depth, not the coking-coal berth's real
  draft. Paradip's own live "Berth Specifications" page
  (paradipport.gov.in) names Berth No. 3 explicitly as the "New Coal
  Import Berth" handling **coking coal**, at LOA 300m/beam 46m/**draft
  16.00m** — corrected from 17.1m to 16.0m, LOA and beam filled in
  (previously blank).
- **Haldia partially upgraded.** LOA/beam were blank, now filled in
  (230m/32.26m) from a port-agent reference sheet identifying the
  coking-coal berth as 4A; draft (9.0m) was already close to right and is
  now corroborated (a separate source independently gives 9.1m) rather
  than resting on the deck alone. Real confirmation that Haldia's draft
  genuinely varies monthly (river port, republished by the port
  authority) — still no exact reduction figure, so `monsoon_draft_reduction_m`
  is unchanged, but the *reason to trust* the existing 1.0m guess less
  than the others is now better evidenced, not just asserted.
- **The PDF-parsing trick that unlocked all of this**: `WebFetch`'s own
  text extraction fails on these government-hosted PDFs (returns
  "corrupted/compressed binary"), but it still saves the raw file locally
  — reading that saved file with the `Read` tool (which has real PDF
  parsing) worked every time. This was the actual blocker in the prior
  pass, not the sources being unreachable.
- **Verified, not just edited**: re-ran the full ranking pipeline after
  all three port corrections — Capesize is now feasible at exactly the 3
  ports with real draft ≥18.0m (Gangavaram, Dhamra, Vizag) and correctly
  excluded at the other 3, confirmed by direct query, not assumed.
- **USA transit time corrected**: was a pure guess (29 days). Real sourced
  figure found for Baltimore→Chennai (India's *east* coast, the coast that
  matters here) is 12,094 NM → ~37 days, meaningfully longer than assumed.
- **Mozambique transit time upgraded, not fully resolved**: a real figure
  exists for Nacala→Nhava Sheva (2,883 NM, ~8.5 days) but that's India's
  *west* coast (Mumbai) — our 6 ports are all east coast, which needs
  rounding Sri Lanka. Adjusted to ~3,800 NM / 12 days as a reasoned
  estimate, flagged `derived_estimate_from_partial_real_data` rather than
  claimed as sourced, since no direct east-coast figure was found.

## Known gaps still open

1. ~~Single global monsoon window~~ — resolved: each port now has its own
   window in `ports.csv`, used by `feasibility.py`.
2. Rail cost is real or derived from sourced distances for **22 of 30**
   port-plant pairs (Haldia↔Bhilai became an exact FOIS quote). The other 8
   (Dhamra↔Bhilai, Haldia↔Rourkela/Bokaro, Gopalpur↔Bhilai/Durgapur/Bokaro,
   Paradip↔Durgapur/Burnpur) are estimated from straight-line distance × the
   median rail circuity of the sourced routes — see "Audit and completion round".
3. Mozambique transit days are a derived estimate (a sourced Nacala–Mumbai
   distance plus the extra leg round Sri Lanka); USA is now sourced.
4. Freight-rate forecasting (Stage 4) runs on a synthetic-but-calibrated
   series, not real Baltic Exchange data — see the Stage 4 section above.
   The deck's "85% forecast accuracy" and "5-12% cost savings" claims are
   still not independently backed by this codebase until that's swapped.
5. Multi-shipment planning's port-capacity cap (Stage 5) is illustrative,
   not a verified real berth-slot-per-month figure for any of the 7 ports.
   It counts port calls (a split cargo uses one slot per voyage) and can be
   scaled to each port's real dry-bulk traffic.
8. Sagar-Sandheads figures (transloading cost, rate, days) are the least
   certain data in the project; wait ranges don't vary by month or ship size.
6. Live vessel positions come from MarineTraffic's public AIS map, embedded
   on Ports and the landing page; there is no AIS feed into the planner's own
   figures (that needs a paid provider key). Live weather is fully real
   (Open-Meteo).
7. Cloud deployment is prepared (Vercel + Render, `docs/DEPLOY.md`) and the
   code is on GitHub; creating the Vercel and Render projects needs the
   owner's accounts, so it isn't live yet.

### Code-level gaps closed (2026-09-22)

An audit of `src/`, `backend/`, `data/`, `db/`, and `scripts/` found two real
bugs and two infra gaps, all now fixed:

- **`scenario.py`'s spot-vs-contract cost comparison had dead code**
  (`cargo_tonnes * forecast_point * 0`) that made `cargo_tonnes` inert —
  the whole-voyage $ figures were already correct (`hire_days * rate`), but
  the dead multiplication obscured that. Removed, and `cargo_tonnes` now
  does something real: a per-tonne column (`estimated_hire_cost_usd_per_tonne`)
  was added to `cost_comparison`, additive to the existing API response.
- **`cost_engine.py`'s `gangavaram_real_port_charges()` hardcoded the real
  BPTS tariff as Python literals** instead of reading
  `data/gangavaram_real_tariff_reference.csv`. The CSV was restructured to
  one row per GT-tier (previously two rows crammed multiple tiered numbers
  into free-text cells) and is now the actual source of truth, loaded via
  `data_loader.load_gangavaram_tariff()`. Verified to reproduce the old
  hardcoded output exactly across the real vessel-class GT matrix
  (`tests/test_cost_engine.py::test_gangavaram_tariff_matches_pre_refactor_values`).
- **`db/schema.sql`'s `port_daily_activity` table was never populated** —
  `scripts/load_postgres.py` now builds it from a union of the 4 full-history
  IMF PortWatch files (2019–2026) and the raw pull (adds Gopalpur + fills
  `export_dry_bulk` for the ~103-day overlap window). Along the way, found
  that Visakhapatnam's full-history file already carries real
  `export_dry_bulk` for its entire range — preserved rather than overwritten
  by the narrower raw-file figure. A new `gangavaram_tariff_reference` table
  mirrors the restructured tariff CSV. Verified end-to-end against a real
  Postgres container: 11,347 rows loaded, zero primary-key collisions.
- **`pydantic` was used directly but not listed in `requirements.txt`**
  (only present transitively via fastapi) — added explicitly, along with
  `pytest`/`httpx` for the new test suite below.
- **Zero automated tests existed anywhere.** Added a pytest suite
  (`tests/`, 52 tests) covering feasibility, cost engine, ranking, scenario
  planning (including a regression test for the dead-code fix above),
  multi-shipment CP-SAT optimization, backtesting, forecasting, and the
  FastAPI endpoints via `TestClient`. Run with `pytest tests/ -v`.
