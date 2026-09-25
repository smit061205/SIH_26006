# SIH26006: what the problem asks, and where Freightwise answers it

**Problem statement:** SIH26006, Ministry of Steel / SAIL, "Development of an Intelligent Freight Forecasting Model for Optimized Vessel Chartering and Bulk Cargo Procurement from overseas to East Coast of India". The official text is mirrored at github.com/NoBugNinja/Smart-India-Hackathon-SIH-2026-Problem-Statements (`README_DETAILED.md`).

**Scope in the statement:**
- Coking coal from Australia, the USA, Mozambique, Russia and Indonesia.
- Discharge at Paradip, Visakhapatnam, Gangavaram, Gopalpur, Dhamra, Sagar-Sandheads and Haldia.
- Handysize, Supramax, Panamax and Capesize ships (Freightwise adds Post-Panamax).
- A model and dashboard that forecasts freight and advises on:
  - market-entry timing;
  - the vessel type for the cargo and each port's limits;
  - idle-time management with alternative employment;
  - early warnings;
  - moving from single spot fixtures to multi-voyage contracts.
- It should use economic indicators, commodity prices and loading-port data.

## Requirement by requirement

| The statement asks for | Freightwise | Code |
|---|---|---|
| Freight forecasts by vessel type | Weekly time-charter rate for each class, 26 weeks ahead, with an 80% range. Each class uses the better of ARIMA and gradient-boosted trees with coal, Brent and the rupee, chosen by walk-forward backtest error (MASE). Post-Panamax is the Panamax index times its premium. **What's behind each forecast**: momentum, the usual seasonal move and the level against three years, and the drivers model's permutation importance. | `src/forecast.py`, `src/backtest.py`, `src/explain.py`, `/api/forecast`, Freight outlook |
| Freight forecasts **by trade route** | Sea freight per tonne for every load port to discharge port pair a class can sail: hire for the voyage days, bunkers and port costs over the tonnes carried, now and at 4, 12 and 26 weeks, plus a weekly history and forecast chart per route. | `src/route_freight.py`, `/api/route-freight`, Freight outlook, "Freight by trade route" |
| Economic indicators and commodity prices | Coal (Australia), Brent and USD/INR feed the tree model's forecast and the bunker price (VLSFO ≈ Brent × 7.6 $/t). They are shown with their three- and twelve-month moves. | `scripts/fetch_market_drivers.py`, `data_loader.bunker_price_usd_per_tonne` |
| Market-entry timing | The best week to fix inside the laycan horizon, and a fix now / wait / stagger signal with the saving. | `src/timing.py`, Charter plan card 2 |
| **Cost reduction against today's practice** (the statement's goal) | The planner's own rules (fixing signal and contract split, forecasts from the history up to each start date only) replayed against fixing every voyage on spot as it comes up: median saving, share of start months cheaper, worst-to-best range, per class and contract length. On the calibrated series, 6- and 12-month contracts cost a median 1.4-2.8% less hire and were cheaper in 62-75% of start months; the worst months cost up to 31% more (a lock-in just before rates fell). | `src/savings.py`, `/api/savings`, Charter plan headline, landing |
| Vessel type by draft, LOA **and cargo-handling capability**, at both ends | Draft (with monsoon reductions), LOA, beam and accepted classes at each discharge port. Draft, LOA, beam and DWT limits at each loading terminal. Each port's unloading equipment (grab unloaders, mobile harbour cranes, floating cranes) sets the discharge rate. Geared Handysize and Supramax ships add their own cranes at ports without shore unloaders. | `src/feasibility.py`, `cost_engine.discharge_rate_for`, `data/ports.csv` (`handling_type`) |
| Loading-port data and congestion | Loading-terminal limits and load rates. IMF PortWatch dry-bulk calls at each origin raise the expected loading queue (1.5 days × activity factor, 1–3×), which counts in lead time and hire. Loading-port alerts appear on the plan and on Ports. | `data_loader.origin_wait_days`, `alerts.origin_congestion_alerts` |
| Idle-time management | Idle days per call (berth queue and weather) and their cost, plus the ports, classes or months that cut them. **Virtual arrival**: where the berth queue is long, the slower speed (not below 10 knots) that arrives as a berth frees up, and the fuel, cost and CO2 it saves. Time charter vs voyage charter with laytime and expected demurrage per option. | `scenario.idle_time_analysis`, `cost_engine.virtual_arrival`, `cost_engine.voyage_charter_terms`, Scenarios, Charter plan, Vessel & port |
| **Alternative employment** for idle ships, and low-demand periods | For a spell the chartered ship isn't needed, three options: wait on hire, sublet at the forecast market rate less 3.75% commission, or a backhaul voyage (east-coast India iron ore or pellets to Qingdao, then ballast to the load port). Each is costed over the window, and a backhaul that would make the ship late is flagged. Low-demand periods cover stock above the plant's buffer, monsoon months at the port, and the weeks the market pays over the hire. | `src/employment.py`, `data/backhaul_lanes.csv`, `/api/scenario/employment`, Scenarios, "Keep an idle ship earning" |
| Early warnings | Sea state (Open-Meteo marine forecast), long berth waits, discharge and loading ports busier than normal, freight rate moves and uncertainty. Disruption notices come from the data file and from developers in the app. Thresholds are adjustable. A **stress test** on the Charter plan re-ranks every option under a freight or bunker move, longer berth queues or a closed port, and says when the choice should change. | `src/alerts.py`, `/api/alerts`, `/api/notices`, `/api/stress` |
| Move to multi-voyage contracts | Contract length (spot, 3, 6 or 12 months) is an input. The plan holds one vessel class for every month and shows the port month by month. Each month is also priced at that month's forecast spot rate, and the recommended contract/spot split is given. | `src/schedule.py`, `scenario.recommend_contract_split` |
| Dashboard | Charter plan (one screen: verdict, what to charter, when to fix, contract or spot, voyage schedule, warnings, plant stock, the voyage on a globe), plus Vessel & port, Freight outlook, Scenarios and Ports. | `frontend/src/pages` |

## The planner's workflow

1. **Set the shipment** in the bar under the top bar. Every page uses it, and it lives in the URL, so a plan can be bookmarked, saved or shared.
2. **Charter plan:**
   - the verdict;
   - the class and port to charter, with the fixture terms;
   - when to fix;
   - how much to put on contract;
   - the month-by-month schedule with the spot alternative;
   - what to watch;
   - whether the plant's stock lasts until the first cargo arrives (using the planner's own stock figure);
   - the voyage on a globe.
3. **Vessel & port:**
   - every feasible class and port ranked by landed cost at the plant;
   - each class's best port, and why a class can't be used;
   - the cost build-up (hire, bunkers, handling, port charges, waiting, rail);
   - where each class fits, with each port's unloading equipment.
4. **Freight outlook:**
   - the class's rate forecast and the best week;
   - freight by trade route;
   - market drivers;
   - contract or spot;
   - forecast accuracy against the other models.
5. **Scenarios:**
   - idle time and how to cut it;
   - the cost of waiting;
   - keeping an idle ship earning;
   - a port closed;
   - several shipments competing for berth slots (OR-Tools CP-SAT).
6. **Ports:**
   - each discharge port's limits this month, equipment, activity and sea state;
   - the port in 3D (its own section) with the ship at the berth and the ships waiting;
   - the loading terminals and their congestion.

## What the planner enters, and why

A charter fixture is agreed on cargo, quantity ± tolerance, laycan, load and discharge ports, and vessel. The inputs follow that, plus what the statement needs for the supply-chain view.

| Input | Why it's asked |
|---|---|
| Plant | The demand point. It sets the rail leg, the stock position and the default discharge ports. Taken from the planner's profile when it names a plant. |
| Coal grade (hard coking, semi-soft, PCI) | Origins ship different grades. The load-port list narrows to those that ship the grade. |
| Load port / origin | Sets the sea route, transit, loading-terminal limits and queue. |
| Cargo per shipment | Sets ship size and the number of voyages. |
| Quantity tolerance (0, ±5%, ±10%, more or less at the owner's option) | Lets a cargo just over a ship's payload ship in fewer voyages. The plan shows the tonnes actually shipped. |
| Laycan (whole month, or dates) | The window the ship must present in. It sets arrival timing, the weather window and the days until stock runs out. |
| Contract length (spot, 3, 6, 12 months) | The statement's move from spot fixtures to multi-voyage contracts. |
| Fixed vessel type or discharge port (optional) | When a ship is already fixed or a port is mandated. |
| The plant's current stock (on the Charter plan) | Drives urgency. The reference figure is only a placeholder until the planner enters the real one, which is saved to their account. |
| Alert thresholds | How rough, busy or volatile before a warning. |

## Data and how firm it is

Every CSV row carries a source note and a confidence column. In summary:

- **Live or sourced:**
  - sea state (Open-Meteo, live);
  - port activity (IMF PortWatch);
  - coal, Brent and INR (FRED, ECB);
  - port limits, monsoon windows and unloading equipment (port documents and industry reports);
  - rail freight for most port–plant pairs;
  - sea-route distances (searoute over the MARNET lanes).
- **Calibrated synthetic:** the weekly freight rate series, anchored to published Baltic index levels. Real Baltic Exchange data is a paid subscription.
- **Estimates flagged in the data:**
  - backhaul freight rates on the Qingdao lane;
  - sublet commission;
  - the loading-queue base;
  - a few rail pairs, from distance × circuity;
  - Sagar-Sandheads transloading.

## Out of scope, and why

- **Real Baltic Exchange rates:** a paid feed. The synthetic series is calibrated to the published indices.
- **Live AIS positions:** needs a credentialed provider. The Ports page embeds MarineTraffic's public map instead.
- **SAIL's actual plant stocks and contracts:** not public. Planners enter their own stock.
- **Deployment:** live at https://freightwise-seven.vercel.app (Vercel), with the API on Render and accounts in Neon; see `docs/DEPLOY.md`. **Try the live demo** opens the planner without an account.

## Readiness check (25 September 2026)

A last pass over the statement, the app and the build before submission.

**Against the statement**

| Requirement | Status | Where to see it |
|---|---|---|
| Freight forecasts by vessel type, with explanation | Met | Freight outlook: 26 weeks, 80% range, best week, what's behind it, accuracy against other models |
| Freight by trade route | Met | Freight outlook, "Freight by trade route" |
| Economic indicators and commodity prices | Met | Coal, Brent and USD/INR in the drivers model and the bunker price; "What's moving the market" |
| Market-entry timing | Met | Charter plan card 2 |
| Vessel type by draft, LOA and cargo handling, at both ends | Met | Vessel & port; Ports; 3D port scene with the depth under the keel |
| Loading-port data and congestion | Met | Loading-queue days in lead time and hire; loading-port alerts |
| Idle time, alternative employment, positioning | Met | Scenarios; virtual arrival and voyage vs time charter (demurrage) |
| Early warnings and risk | Met | What to watch, Ports, alert settings, stress test |
| Spot to multi-voyage contracts, with the saving quantified | Met | Contract length, schedule with the spot alternative, split; savings replay against month-by-month spot |
| Dashboard with cargo, ports and contract duration inputs | Met | Shipment bar on every page; CSV and printable proposal |
| Real market freight data | Partly | The weekly series is calibrated synthetic (Baltic data is paid); every model, replay and screen works unchanged on a licensed feed or SAIL's own fixture history |

**Product and engineering**

| Check | Result |
|---|---|
| Backend tests (`pytest tests/`) | 238 passed |
| Type-check and production build (`npm run build`) | Passed |
| Lint (`npm run lint`, oxlint) | No warnings |
| 3D geometry and data checks (`npm run check:hull`) | Passed |
| Free-tier server (0.1 CPU, 512 MB), measured in Docker | Demo sign-in 0.4 s, first plan 3.1 s, repeat 0.6 s, other endpoints under 1 s, 177 MB |
| Hindi | Every interface string has a Hindi entry (machine-assisted; native review advised) |
| Access for evaluators | "Try the live demo": no sign-up; demo accounts deleted after a day |
| Security | Salted scrypt passwords (OWASP settings), HttpOnly Secure cookies, CSRF header, rate limits and lockout, CSP and HSTS |
| Privacy (DPDP) | Consent notice, export and delete; operator details still to fill in `/privacy` and `/terms` |

**Verdict:** ready to demonstrate. Before a real launch: fill in the operator
details in the privacy notice and terms, and swap in a licensed freight-rate
feed or SAIL's fixture history if one becomes available. Signing in with a
password takes a few seconds on the free server (strong password hashing on
a tenth of a CPU); the demo is instant.
