# Live setup (Cloudflare)

Same design as PGL (one D1 database, phone sign-in), deployed as a Cloudflare Worker with static assets. About 5 minutes in the dashboard.

## 1. Create the Worker from GitHub
Workers & Pages → **Create** → **Import a repository** → **griar1999/733XZ**.
- Project name: `733xz`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Deploy. The database (`planeshare-db`) is already connected through `wrangler.jsonc`; tables are created the first time the site runs.

## 2. Set your admin code
**733xz** → **Settings** → **Variables and Secrets** → **Add**
- Type: **Secret**
- Name: `ADMIN_CODE`
- Value: a code only you know, 8–16 letters and numbers (for example `XZ-G-2026-ABCD`). Dashes and case don't matter.

Optional: `OWNER_NAME` (Text), your name as shown in the app (defaults to `G`, read only on first start).
Secrets apply right away and are kept on later deploys.

## 3. Custom address
**733xz** → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `733xz.riarinc.com`.
riarinc.com is already on Cloudflare, so the DNS record is added for you.

Every push to `main` redeploys automatically.

## First sign-in
Open 733xz.riarinc.com → **Have a sign-in code instead?** → enter your ADMIN_CODE. You're signed in as the admin.
1. More → **Settings**: set the aircraft model, home airport and photo. Rate is $50/hour on Hobbs, fuel paid at the pump, top-off required. Change any of these there.
2. More → **Members and sign-in** → **Add a member** with name and phone, five times. Or add them, then paste a "Name, phone" list.
3. Text each member the link. They sign in with their phone number and can add it to their Home Screen.

Phone-only sign-in is convenient, not strong security: anyone who knows a member's number can sign in as them. Every change records who made it. If that's a concern, give members sign-in codes instead and don't add phone numbers.

## How it works
- One D1 database. The schedule is one JSON document with a version number.
- Every change goes through `POST /api/action`, which runs the same rules code the app uses (`src/services/actions.ts`) as the signed-in member. The server decides who you are from the session cookie, never from the request.
- Double-booking: the server re-checks overlaps against the latest saved data and saves only if nobody else saved in between (`UPDATE … WHERE version = ?`). If someone did, it re-runs the check against their change. Tested with 10 simultaneous requests for one slot: exactly one wins.
- Photos are stored in their own table and served only to signed-in members.
- Codes are 8 characters, stored only as salted hashes, shown once. A new code signs that member out of other phones. 10 failed tries per 10 minutes per network.
- Deactivating a member in Settings signs them out everywhere.
- Backups: D1 Time Travel keeps 30 days of point-in-time history. The app also keeps one copy of the data per day for 60 days (`snapshots` table).

## Local testing
`npm install`, then put `ADMIN_CODE="..."` in a `.dev.vars` file (not committed), then `npm run dev:live` (runs `wrangler dev` with a local database).
Site runs at http://localhost:8788 with a local database. `npm run test:live` runs the end-to-end checks against it.
