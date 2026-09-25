# Freightwise frontend

React 19, TypeScript and Vite. Data comes from the FastAPI backend in `../backend` through the typed wrappers in `src/api.ts`. The design system is in [DESIGN.md](DESIGN.md), and the product overview is in the project [README](../README.md).

## Run

```bash
npm install
npm run dev          # http://localhost:5173, with the backend on :8000
```

To point at another API, set `VITE_API_BASE`.

## Check

```bash
npm run build        # type-check (tsc -b) and bundle
npm run lint         # oxlint
npm run check:hull   # 3D geometry, sea state, sea routes, and the sample classes against the CSV
```

## Structure

- `src/pages/`: one file per page. The app pages are CharterPlan, VesselPort, FreightOutlook, Scenarios and Ports. Account covers the profile, sessions, developer code and DPDP rights. Auth has the sign-in and create-account tabs. Kit holds the developer tools: the component kit, the 3D bench and the disruption notices.
- `src/lib/`:
  - `shipment.tsx`: the shipment the planner sets, kept in the URL (plant, grade, load port, cargo, tolerance, month, laycan, contract, fixed class or port);
  - `queries.ts`: TanStack Query hooks;
  - `router.tsx`: a small history router;
  - `i18n.ts` and `i18n-hi.ts`: English and Hindi;
  - `format.ts`: USD/INR and dates;
  - the alerts, labels, theme and saved plans.
- `src/components/ui/`: layout, figures, inputs, forms, tables (rows have a real button for keyboards), overlays, feedback states, bars, alerts and drivers.
- `src/components/charts/`: Recharts and SVG charts. `FreightChart` plots either $/day or $/t.
- `src/components/ship3d/`: the 3D views (see "Ships and the 3D world" in the project README):
  - `hull.ts` builds each ship from its particulars as plain maths, checked by `check:hull`;
  - `parts/` holds the hatches, deck gear, fittings, superstructure and underwater parts;
  - `materials.ts` has the PBR paint and markings;
  - `Ocean` and `Environment` draw the sea, sky, clouds and light;
  - `slots.ts` and `SharedCanvas.tsx`: one WebGL canvas per page, drawing every 3D view in its own box, with the frame governor;
  - `post.ts` is the post-processing chain (`ViewComposer`);
  - `quality.ts` sets the quality tiers;
  - `PortStage` and `Globe` are the port scene and the globe.
- `public/3d/`: CC0 HDRIs and PBR textures, credited in `CREDITS.md`.

## Conventions

- Every visible or spoken string goes through `t()`, `tr()` or a component that translates its props. New strings get a Hindi entry in `src/lib/i18n-hi.ts`.
- three.js objects are mutated in small module-level helpers, not inline in components (React's immutability lint rule).
- 3D views render only on capable screens (`use3d`), load lazily, and fall back to the SVG `ShipProfile` or `FlatMap`.
