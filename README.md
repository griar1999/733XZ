# PlaneShare — N733XZ

Scheduling, check-out and return, flight-hour records, maintenance and issues for one shared aircraft and its members. Built the same way as PGL: Cloudflare Pages + Pages Functions + D1.

- **Live site:** 733xz.riarinc.com (after setup — see `docs/SETUP_LIVE.md`)
- **Demo:** `npm run build:preview` makes a single-file demo with fictional data for the Claude preview.

## Run it

```bash
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run build       # dist-live/  — what Cloudflare Pages serves
npm run dev:live    # local live site with a local D1 database (needs .dev.vars)
npm run test:live   # end-to-end checks against the local live site
```

## Group rules (set in the app, admin → Settings)
- Rental $50.00 per hour, billed on Hobbs.
- Fuel: top off on return; pilot pays at the pump. Gallons and cost are recorded on each flight record. Switch to "add to statement" if the group reimburses fuel.
- Usage statements only. The app does not take payments.

## Structure

```
src/domain/     Pure rules (time zones, decimal meter math, overlaps, charges). Used by app and server.
src/services/   actions.ts — every change as a named action, run on the phone (demo) or the server (live)
                mockApi.ts (demo), httpApi.ts (live), seed.ts
src/ui/         React screens; live.tsx has sign-in and member access
server/core.ts  D1 schema, sessions, sign-in, versioned saves, photos
functions/api/  Pages Functions: login, logout, me, state, action, photo, admin/*
public/         manifest, service worker, icons, _headers
```

## What the server enforces
Sign-in (phone number, sign-in code, or admin code) · every permission · overlap and buffer checks against the latest saved data · meter readings that can't go backwards · duplicate flight submissions · groundings that only an admin can clear, with a reason · full activity history.

## Not included
Billing or payments, flight planning, weather, public sign-up, push notifications (PGL has these; can be added).
Operational usage records only — not a replacement for pilot or aircraft logbooks, and an open calendar slot says nothing about airworthiness.
