---
title: Freightwise API
emoji: 🚢
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
short_description: Charter-planning API for SAIL coking-coal imports (SIH26006)
---

# Freightwise API

The backend of Freightwise (Smart India Hackathon 2026, problem SIH26006):
freight forecasts, vessel and port feasibility, landed cost, timing, contract
planning, alerts and accounts. The web app is served separately and calls
this API through `/api/*`.

This Space is built from github.com/smit061205/SIH_26006 by
`scripts/build_hf_space.sh`; change the code there, not here.

Health check: `/api/health`.
