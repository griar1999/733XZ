# Live setup (Cloudflare)

Same setup as PGL. About 10 minutes in the Cloudflare dashboard. Nothing to install.

## 1. Create the Pages project from GitHub
Workers & Pages → **Create** → **Pages** → **Connect to Git** → pick **griar1999/733XZ**.
- Project name: `733xz`
- Production branch: `main`
- Framework preset: **None**
- Build command: `npm run build`
- Build output directory: `dist-live`
- Environment variable (Build): `NODE_VERSION` = `22`

Save and Deploy. The first deploy will show "database is not connected yet" — that's expected until step 3.

## 2. Create the database
Storage & Databases → **D1** → **Create** → name it `planeshare-db` → Create.
Tables are created automatically the first time the site runs.

## 3. Connect it to the site
Workers & Pages → **733xz** → **Settings** → **Bindings** → **Add** → **D1 database**
- Variable name: `DB`
- Database: `planeshare-db`

## 4. Set your admin code
Same page → **Variables and Secrets** → **Add**
- Type: **Secret**
- Name: `ADMIN_CODE`
- Value: a code only you know, 8–16 letters and numbers (for example `XZ-G-2026-ABCD`). Dashes and case don't matter.

Optional:
- `OWNER_NAME` (Text): your name as it shows in the app. Defaults to `G`. Only read the very first time the site starts; after that, rename yourself in Settings → Members.

## 5. Redeploy
Deployments → latest → **⋯ → Retry deployment**. Bindings and secrets apply on the next deploy.

## 6. Custom address
**733xz** → **Custom domains** → **Set up a custom domain** → `733xz.riarinc.com` → Activate.
Because riarinc.com is already on Cloudflare (PGL uses it), the DNS record is added for you.

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
`npm install`, then put `ADMIN_CODE="..."` in a `.dev.vars` file (not committed), then `npm run dev:live`.
Site runs at http://localhost:8788 with a local database. `npm run test:live` runs the end-to-end checks against it.
