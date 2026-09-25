# Freightwise design system

The reference for anyone changing the frontend. Tokens live in
`src/index.css`; components in `src/components/ui`, `charts`, `shell`. A
live gallery of every component and state runs at `/kit` in dev builds.

## Principles

- **Verdict first.** Each page opens with one serif sentence that answers its
  question, then the figures, then the evidence.
- **One colour, one job.** Navy (`accent`) means interactive or selected.
  Orange (`signal`) means "the answer": the nominated option, the forecast.
  Everything else is ink on paper.
- **Rules, not cards.** Content sits on the page, separated by hairlines. A
  white raised surface is only for tables, charts and overlays.
- **Domain language and units.** Landed cost, voyage total, demurrage, $/t,
  $/day, HSZ / SMX / PMX / PPMX / CAPE. Sentence case, British/Indian spelling, no
  em dashes, units always attached.
- **Never out of date on screen.** While inputs recalculate, the previous
  result stays visible (dimmed) and a 2px hairline shows progress.

Avoid: glows and gradients, shadows on content, KPI tiles with icons, pill
badges, uppercase micro-headings, count-up numbers, page transitions,
decorative icons, promotional or defensive copy.

## Colour (light)

| Token | Value | Use |
|---|---|---|
| paper | `#f6f5f1` | Page |
| surface | `#ffffff` | Tables, charts, overlays |
| sunken | `#efede7` | Table header band, segmented track |
| hover | `#f1efea` | Row hover |
| rule / rule-strong | `#ddd9d0` / `#b9b3a7` | Hairlines / input borders |
| ink / ink-2 / ink-3 | `#15171b` / `#454a53` / `#60656e` | Text; ink-3 ≥ 4.8:1 on every surface |
| accent / accent-hover / accent-tint | `#1e3a5f` / `#16304f` / `#e7ecf2` | Interaction, selected row |
| signal / signal-fill / signal-tint | `#a8431a` / `#c4501a` / `#f8e9df` | The answer |
| positive / negative / caution | `#2e7549` / `#b42318` / `#8f6200` | Meaning only, never a series |
| grid | `#ebe8e1` | Chart gridlines |

**Chart series**, fixed order, never cycled: `#2f63a3`, `#c4501a`,
`#00897b`, `#b8860b`, `#8a5ba8`. Validated with the dataviz skill script
(`validate_palette.js … --mode light --surface "#FFFFFF"`): all five checks
pass (worst adjacent CVD ΔE 11.9, normal-vision ΔE 19.4, contrast ≥ 3:1).
Re-run the script after changing any slot.

`@theme static` is required: several tokens are only read from TypeScript
(chart props, inline styles) and Tailwind would otherwise drop them.

## Type

Source Serif 4 (variable, optical sizing) and Source Sans 3 (variable), both
self-hosted via `@fontsource-variable`. Both ship tabular lining figures by
default, so table columns align without a monospace font. Large standalone
figures switch to proportional figures. The ₹ glyph is in the latin-ext
subset, which loads on demand.

| Role | Face | Size / line | Weight |
|---|---|---|---|
| Wordmark | Serif | 21 / 1 | 600 |
| Page title | Serif | 34 / 1.15 (27 phone) | 600 |
| Verdict | Serif | 25 / 1.3 (21 phone); section verdict 19 | 450 |
| Section title | Serif | 20 / 1.3, 1px ink rule above | 600 |
| Figure value | Sans | 30 / 1.1 (24 phone) | 600 |
| Body | Sans | 15 / 1.55, max ~68ch | 400 |
| Table | Sans | 14 / 1.4 | 400, key column 600 |
| Label, table header | Sans | 12.5–13, sentence case | 600 |
| Caption | Sans | 12.5–13.5 | 400 |

## Space, shape, motion

- Spacing steps: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Sections 56 apart
  (48 on phones). Content max 1200px; gutters 32 / 24 / 16.
- Radii: 3px controls, 4px surfaces, 0 for tables and rules.
- Shadow only on overlays (`--shadow-overlay`).
- Motion: 120–200ms colour and position changes only; all disabled under
  `prefers-reduced-motion`.
- Focus: 2px accent outline, 2px offset, `:focus-visible` only.

## Numbers and currency (`src/lib/format.ts`)

| Quantity | USD | INR |
|---|---|---|
| Per tonne | `$14.21 /t` | `₹1,360 /t` |
| Totals | `$1,065,750` | `₹10.20 cr`, `₹98.5 lakh` |
| Day rate | `$32,276 /day` | `₹30.9 lakh/day` |
| Axis | `$30k` | `₹29 L` |
| Deltas | `+$5,750`, `−$1,200` (true minus) | same |

The rate comes from Frankfurter (ECB reference, keyless) once per load; if it
fails the app uses ₹96.00 and says "fixed rate" next to the toggle.

## Charts

Follow the dataviz skill: 2px lines, bars ≤ 24px thick with 4px rounded ends,
solid hairline gridlines, ~12% area washes, a legend for two or more series,
sparing direct labels, a crosshair tooltip on lines, a hover tooltip on bars,
and a table view for every chart (Freight outlook has "Show as table").

## Pages and placement

Pages are ordered the way a chartering manager decides: inputs, answer,
reasons, risks, detail. Each page answers one question on its first screen.

| Page | Question | Order on the page |
|---|---|---|
| Charter plan (`/plan`) | What do I book, when, on what terms, what's at risk? | Verdict; left: numbered cards 1 What to charter, 2 When to fix, 3 Contract or spot, 4 Voyage schedule, each ending in a link to its detail page; right: Watch out (alerts, `#watch-out`), Plant stock. On phones: verdict, What to charter, Watch out, the other cards, plant stock. Header actions: Print plan, Save; a Compare section appears once a plan is saved. |
| Vessel & port | Which ship type and port, and why? | Verdict and figures (voyages, lead time), the ship types in 3D, best option for each vessel type, all options (top 8, "Show all"), cost build-up (with bunkers and the loading-port queue), fit matrix with load-port strip and each port's unloading equipment |
| Freight outlook | Where is the market going, when to fix? | Filter row (vessel type, horizon, contract), timing verdict, figures (the range names its model), chart (best week ringed only when worth waiting), freight by trade route (table and $/t chart), what's moving the market, contract cover, model accuracy (collapsed) |
| Scenarios | What if waiting, closures or bunching happen? | Idle time and how to cut it, waiting, keeping an idle ship earning (`#employment`: spare days, wait / sublet / backhaul cards, when a ship is likely spare), port closure, several shipments |
| Ports | What can each port take, and how is it now? | Month; comparison with a one-line alert summary (discharge and your loading port) and flags per port; port detail with equipment, sea state and weekly traffic; the port in 3D; loading ports |
| Developer tools (`/kit`) | Does every building block work? | Tabs: component kit (every component and state, sample data, sandboxed alert settings), 3D bench, disruption notices |

The shipment bar order is Plant, Load port, Cargo (per month on a contract),
Delivery / Starting, Contract (Charter plan only), then "Fixture terms" (a
popover on desktop, in the sheet on phones): coal grade, laycan (whole month
or dates), quantity tolerance, fixed vessel type, fixed port. It must fit one row at
1280px and above; on phones it collapses to a summary line and a sheet.

Alerts: severity reads Act / Watch / Note with a coloured dot, never colour
alone. Threshold presets live behind "Alert settings" inside the alerts
block and are remembered per browser (`lib/alertSettings.ts`). The top-bar
count links to the Charter plan's Watch out block.

New components: `ui/alerts.tsx` (AlertList, AlertSettings),
`charts/ScheduleStrip.tsx` (month strip, monsoon months marked),
`charts/Sparkline.tsx` (12-week forecast with the best week ringed),
`charts/StockMeter.tsx` (stock cover vs target vs arrival), and a `bestWeek`
marker on `FreightChart`.

---

## Dark theme ("operations console")

Its own steps, validated against its own surface, not an inverted light
theme. Tokens live in `src/index.css` under `:root[data-theme="dark"]` and,
for people who never chose, `@media (prefers-color-scheme: dark)`.
`index.html` applies a saved choice before first paint; the choice is System,
Light or Dark in the Display menu (`lib/theme.ts`).

- paper `#111214`, surface `#18191c`, sunken `#0c0d0e`; rules are white at
  8% / 16%; ink `#eceae5` / `#b3b0a9` / `#8e8b85` (all ≥ 4.8:1 on every
  surface); accent steel blue `#8db0d8`; signal `#e6905a`.
- Chart series 1–5: `#3986e4`, `#e16b3a`, `#18a292`, `#bb8806`, `#a869cf` —
  the light hues stepped into the dark band; the dataviz validator passes all
  checks with `--mode dark --surface "#18191C"`.
- `--color-band` (forecast range wash), `--color-scrim` (sheet backdrop) and
  `--color-overlay-border` (1px edge on overlays, which lose their shadow on
  dark) are tokens in both themes. Body weight drops to 380 in dark.
- No raw colours in components: `grep -rE "#[0-9a-fA-F]{6}" src --include=*.tsx`
  finds none.
- Printing always uses the light tokens.

## Alerts

Grouped by type (`lib/alerts.ts`), worst first, one line per group: the title
names the count ("Rough sea at 6 ports"), the line lists the two worst items
and "+N more". The Charter plan shows three groups and "Show all"; Ports shows
a one-line summary and flags under each port's name instead of a list.
Severity is a dot plus a word (Act / Watch / Note). Thresholds sit in a small
Settings popover beside the block's title.

## Language

`lib/i18n.ts`: `useT()` translates an English string, with `{name}`
placeholders, via `lib/i18n-hi.ts`; missing entries fall back to English.
Shared components (page header, section, figure, table header, field,
select, segmented control, button, empty and error states, tooltip) translate
their own plain-string props, so pages only wrap sentences built from values.
Dates use Hindi month names; numbers keep their format. Port, plant and vessel
names stay in English. Noto Sans/Serif Devanagari load only when Hindi is on.

## Print, saved plans, shortcuts

- The Charter plan prints as a one-page memo: a print-only header (plant, load
  port, cargo, start, contract, date, currency and rate), chrome hidden, alert
  groups expanded, cards kept whole.
- Saved plans are the shipment query string plus a name in localStorage
  (`lib/savedPlans.ts`); "Compare with a saved plan" shows two plans line by
  line, differences in the accent colour.
- `g` then `c`/`v`/`f`/`s`/`p` switches pages; `?` opens the list. Ignored while
  typing.

## Ships in 3D

Ships are built from data, not imported (`components/ship3d`): `hull.ts` is
pure geometry (plus `waves.ts`, `geo.ts`), `Ship` assembles the hull and the
`parts/`, `ShipStage` holds the shared `Stage` and the single-ship and fleet
scenes, `PortStage` the port, `Globe` the voyage globe; `ShipProfile`,
`FlatMap` are the SVG fallbacks.

Rules:
- **Real paint, theme lighting.** Ships wear marine colours (`paint.ts`) in
  both themes; the theme changes the sky (afternoon or dusk) instead. Labels,
  globe land and sea, and UI chrome use the theme tokens.
- **Markings are drawn, not decaled:** draft marks, load line and name come
  from the hull shader in hull coordinates.
- **Controls outside the canvas:** viewpoints, forecast day and cargo are
  ordinary buttons and sliders; the canvas also has + and - zoom buttons.
  Drag turns the view; the wheel and a trackpad pinch zoom it (the landing
  page excepted, so it keeps scrolling there; its + and - buttons still zoom).
- **Say it in words too:** every scene has a text description (`aria-label`)
  and the figures it shows (draft, freeboard, depth to spare, day and sea)
  are also in text next to it.
- **Fallbacks:** below 640 px (768 px for the landing showcase), in print and
  without WebGL, show `ShipProfile` or `FlatMap`. Reduced motion stills the
  sea, the ship and the radar.
- **Cost:** everything three.js lives in the lazy `SharedCanvas` chunk;
  nothing on a page imports `three` directly. A page has **one** WebGL canvas
  whatever the number of views (`slots.ts`, `SharedCanvas.tsx`); a view draws
  at full rate only while it moves, at 30 fps when animated, once when still,
  and never off screen. Tiers step down only on sustained dropped frames
  (`quality.ts`; the viewer can fix a tier under Display, "3D quality").
  Anything drawn over a 3D view (its buttons, a header) sits at `z-index` 21
  or more, above the canvas.
- **One look, one pipeline:** every scene goes through `ViewComposer`
  (`post.ts`: occlusion, bloom over white, AgX, SMAA, vignette) except the
  transparent globe. Lights that should glow are HDR (colour above 1), not
  emissive tricks; they come on with the preset's `night` value (dusk).
  Materials are shared per kind (`usePaint`) so each shader compiles once.
- **Below the waterline:** every ship view can orbit under the sea; the haze,
  particles and caustics switch on as the camera goes under.
- **Per-class truth:** anything drawn differently per class (hatch covers,
  cranes and grabs, fullness) comes from `vessel_classes.csv`, and
  `check:hull` tests it.

## Accounts and the public pages

Sign-in and sign-up are one card with two tabs (`pages/Auth.tsx`; each tab
has its own address). The password field shows its four rules as a live
checklist. Developer accounts carry a "Developer" badge (`ui/badge.tsx`).
Public pages (`/`, sign-in, sign-up, email links, privacy, terms) use
`PublicHeader`/`PublicFooter`; forms use `components/ui/forms` (`TextInput`,
`PasswordInput` with the strength guide, `SelectInput`, `Checkbox`,
`LinkedSentence` for sentences with a link, `FormError` which scrolls itself
into view). Errors are generic where security needs it; sentences with a link
are whole translated templates (`{link}`), since word order differs in Hindi.
The landing page is always light (it sets `data-theme="light"` while mounted
and restores the viewer's choice after). It uses no invented figures, logos or
testimonials: counts come from `/api/public/summary`, the hero's port
conditions from `/api/public/ports` (live), and the feature sketches are
shapes, not figures.

## Other roadmap items

- Native-speaker review of the Hindi text.
- Real Baltic Exchange rates in place of the calibrated synthetic series.
