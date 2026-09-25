# Deploying Freightwise

The web app goes on **Vercel** and the API on **Render**. Vercel forwards every `/api/*` request to Render, so the browser
only ever talks to one origin: the session cookie stays first-party
(`SameSite=Lax`, `Secure`, `HttpOnly`) and no cross-site cookie settings are
needed.

```
browser ──► https://<app>.vercel.app ──► static files (frontend/dist)
                     │
                     └── /api/* ──► https://<api>.onrender.com
```

## 1. Visitors, sessions and email

The site runs as a **live demo**: "Try the live demo" opens the planner on a
throwaway session, deleted after a day. There is no sign-up, sign-in or email,
so no mail service is needed, and sessions can live in the server's own SQLite
file (leave `AUTH_DB_URL` unset; a redeploy clears it, which only ends the
open demos).

Password accounts are still in the code, switched off. To turn them back on,
set `PASSWORD_ACCOUNTS=1`, point `AUTH_DB_URL` at a permanent Postgres (Neon,
neon.tech, is free) and set up email: Brevo's HTTPS API (`BREVO_API_KEY`,
`MAIL_FROM`), since Render's free plan blocks SMTP.

## 2. The API on Render

1. Render → **New → Web Service** → this repository, **Language: Docker**,
   **Dockerfile path** `./backend/Dockerfile`, **Root Directory** empty,
   **Health check path** `/api/health`, Free. (Or **New → Blueprint**, which
   reads the same settings from `render.yaml`.)
2. Environment: `APP_ENV=production`, `COOKIE_SECURE=1`, `COOKIE_SAMESITE=lax`;
   `APP_URL` and `ALLOWED_ORIGINS` come in step 4. (`AUTH_DB_URL`, mail and
   `DEVELOPER_ACCESS_CODE` only with password accounts on, see step 1.)
3. Note the service address, e.g. `https://freightwise-backend.onrender.com`.

`postgres://` URLs are accepted. The planning data and the freight models'
results ship inside the image (`data/`), so the build takes a minute or two and
nothing else needs loading.

## 3. The web app on Vercel

1. Vercel → **Add New → Project** → this repository, **Root Directory
   `frontend`**. The framework (Vite), build command and output directory come
   from `frontend/vercel.json`.
2. In `frontend/vercel.json`, point the `/api/:path*` rewrite at the Render
   address from step 2 if it differs from `freightwise-backend.onrender.com`,
   and commit.
3. Leave `VITE_API_BASE` unset: production builds call `/api/...` on their own
   origin.

`vercel.json` also sets long-lived caching for the hashed bundles and 3D
assets, and security headers: a Content-Security-Policy that allows only this
origin plus Google Fonts (Devanagari), the exchange-rate API and the
MarineTraffic map frame; HSTS; `X-Frame-Options: DENY`; and a strict referrer
policy.

## 4. Tie them together

On the Render service set:

| Variable | Value |
|---|---|
| `APP_URL` | the Vercel address; links in emails point here |
| `ALLOWED_ORIGINS` | the Vercel address |
| `ALLOWED_ORIGIN_REGEX` | optional, for preview deployments |

Redeploy the service after changing them.

## 5. Check it

- `https://<app>.vercel.app/api/health` returns `{"status":"ok"}` through the rewrite.
- The landing page shows live port conditions (from `/api/public/ports`); the
  3D ship and the globe load with no Content-Security-Policy errors in the console.
- "Try the live demo" opens the Charter plan: the browser's cookie list shows
  `fw_session` on the Vercel domain, `Secure`, `HttpOnly`, `SameSite=Lax`.
- The Charter plan, Ports (with the port in 3D) and Vessel & port load; Hindi
  and a phone-width window work.
- "End the demo" clears the cookie.

## Free-tier caveats

- **The API sleeps.** Render's free web service sleeps after about 15 minutes
  idle; the first request then takes up to a minute (the app shows "Can't
  reach the Freightwise service … retrying" and recovers by itself). Before a
  demo, open `/api/health` a few minutes ahead. The repository keeps it awake
  on its own: `.github/workflows/keep-alive.yml` pings `/api/health` about
  every 2 minutes from GitHub (free for public repositories; check it under
  Actions → Keep Render awake), and `python scripts/keep_alive.py` does the
  same from any computer. One always-on free service fits in Render's 750
  free hours a month. Render's Starter plan doesn't sleep at all.
- The free web service's disk is wiped on each deploy, which ends open demo
  sessions (visitors just start a new one).

## Before a public launch

- Fill in the operator's name, address and grievance officer in the privacy
  notice and terms (`/privacy`, `/terms`).
- Optional custom domain: add it in Vercel, then set `APP_URL` and
  `ALLOWED_ORIGINS` on Render to it.

## After that

Every push to `main` redeploys both: Vercel rebuilds the app, Render rebuilds
the API image. Vercel also builds a preview for other branches (allow them
with `ALLOWED_ORIGIN_REGEX` if they need direct API calls).
`docker compose up --build` still runs both services locally, as before.
