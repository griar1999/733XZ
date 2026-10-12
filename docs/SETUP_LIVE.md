# Live setup (Cloudflare Pages)

Same setup as PGL: a Cloudflare **Pages** project connected to this repo, one D1 database, and a CNAME at Name.com.

## Current setup
- Pages project: **733xz** (production branch `main`)
  - Build command: `npm run build` · Output directory: `dist-live` · `NODE_VERSION` = `22`
- D1 database: **planeshare-db** (ID `25354af0-8726-4ab2-9ce9-406e8f44eb18`), bound as `DB` in Settings → Bindings
- Secret: `ADMIN_CODE` (8–16 letters and numbers) in Settings → Variables and secrets
- Address: **733xz.riarinc.com** — Name.com DNS has `CNAME 733xz → 733xz.pages.dev`

Every push to `main` redeploys. Open phones pick up the new version the next time they change screens or pull down to refresh.

## One address only
`functions/_middleware.ts` sends anyone on a `*.pages.dev` link (including one-off deployment preview links) to 733xz.riarinc.com.
To turn that off temporarily (for example if the domain stops working), add a Text variable `CANONICAL_HOST` = `off` and redeploy.

## Optional variables
- `OWNER_NAME` (Text): the admin's display name on first start. Defaults to `G`.

## Sign-in
- Admin code (the `ADMIN_CODE` secret) always signs in as the owner/admin.
- Members sign in with the phone number the admin added (More → Members and sign-in), or a one-time sign-in code.
- Phone-only sign-in is convenient, not strong security: anyone who knows a member's number can sign in as them. Every change records who made it.

## How it works
- One D1 database. The schedule is one JSON document with a version number.
- Every change goes through `POST /api/action`, which runs the same rules code the app uses (`src/services/actions.ts`) as the signed-in member, taken from the session cookie.
- Double-booking: the server re-checks overlaps against the latest saved data and only saves if nobody saved in between (`UPDATE … WHERE version = ?`), retrying otherwise.
- Photos are stored in their own table and served only to signed-in members.
- Codes are 8 characters, stored only as salted hashes. 10 failed sign-in tries per 10 minutes per network.
- Backups: D1 Time Travel keeps 30 days. The app also keeps one copy per day for 60 days (`snapshots` table).

## Local testing
`npm install`, put `ADMIN_CODE="..."` in `.dev.vars` (not committed), then `npm run dev:live` → http://localhost:8788 with a local database.
`npm run test:live` runs the end-to-end checks against it.
