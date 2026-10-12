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

## Phone notifications
Nothing to set up. The server makes its own push keys the first time someone turns notifications on.
Members turn them on from Home (or More → Your account). On iPhone, PlaneShare must be added to the Home Screen first.
- Everyone (except whoever made the change): new bookings, changes, cancellations, groundings, cautions, maintenance.
- Admins: minor issues, flight records flagged for review, returns without a fuel top-off.
- Just you: your booking starts within 2 hours, your return is 15 minutes overdue, maintenance overlaps your booking, a no-show recorded for you.
- The next pilot: the aircraft isn't back yet before their booking.

Reminders and overdue notices are sent by `.github/workflows/tick.yml`, which calls `POST /api/tick` every 15 minutes (GitHub may delay scheduled runs a few minutes). They also go out whenever anyone opens the app.

## Optional variables
- `OWNER_NAME` (Text): the admin's display name on first start. Defaults to `G`.

## Inspections
More → **Inspections** (also summarized on Home). Each shows Last done and Next due:
| Inspection | Due |
|---|---|
| 50-Hour | every 50 tach hours (from the tach at the last one) |
| 100-Hour | every 100 tach hours |
| ELT | 12 calendar months (end of that month) |
| Transponder & Altimeter | 24 calendar months |
| Static & Pitot System | 24 calendar months |
| Annual | Dec 31 of the year after the last one |
| VOR Check | every 30 days (pilots can record this one) |

Current tach = the highest ending tach in the flight log. "Due soon": within 10% of the hours (5 h / 10 h), 30 days for month/annual items, 5 days for the VOR check.
Admins get a notification when one is due soon; everyone gets one when one is overdue. Overdue items show on Home and at check-out. They do not block check-out (that stays an admin decision through a grounding).
Admins can edit intervals, correct last-done values, add inspections, or turn one off. Tracking only — the logbooks are the official record.

## Admin tools
- More → **Monthly statements**: hours, $50/hr rental and fuel per pilot per month; CSV and Print / Save as PDF.
- Members and sign-in (or Settings → Members) → **Remove…**: removes a pilot. They're signed out everywhere, their phone, codes and notifications are deleted, and their upcoming bookings are canceled. Past flights and statements keep their name. You can't remove yourself, the owner account, the last admin, or someone with the aircraft checked out.
- Settings → **Clear test data**: removes bookings, flight records, issues/maintenance/restrictions and optionally activity history. Members, sign-in and settings stay. Type CLEAR to confirm.

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
