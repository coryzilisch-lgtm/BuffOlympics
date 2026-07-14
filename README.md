# Buff Olympics 🦬

The event app for **Buff Olympics — The Herd Games (August 14)**. Two tribes — **Buffalo** and
**Texas Roadhouse** — sign up for games, cook for the Dip Off, claim a relay leg, and follow the day.
SUP refs log scores from their phones; admins run the whole event from a desktop Admin Center.
Team totals stay **sealed** until an admin reveals them at the Closing Ceremony.

Built from the Claude Design handoff (`docs/` has the API contract) on the same stack as Herd-Intranet:
**Azure Static Web Apps** (vanilla-JS SPA + managed **Azure Functions**, Node 20) with a
**Microsoft Fabric SQL Database**.

Because Texas Roadhouse teammates are outside the Buffalo tenant, the app uses its **own
email/password accounts** (PBKDF2 + HMAC session tokens) — not Entra SSO. Referees create accounts
with a **join code** the admin controls.

## It's a PWA — "install" it on your phone

The app ships a web manifest + service worker, so it can be added to the home screen and launches
full-screen like a native app:

- **iPhone (Safari):** open the site → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the site → the **Install app** prompt (or ⋮ menu → **Add to Home screen**).

Desktop browsers work too — wide screens get the games board + Admin Center layouts.

## Repo layout

```
/                       — SPA (index.html, app.js, styles.css) — vanilla JS, no build step
manifest.webmanifest    — PWA manifest (installability)
sw.js                   — service worker (app-shell cache; API is always network)
assets/                 — brand logos + fonts (BN Kragen, Montserrat)
icons/                  — PWA + favicon icons (generated from buffalo-orange.png)
api/                    — Azure Functions v4 (Node 20, app.http model, mssql)
docs/API.md             — the frontend ↔ backend contract (read before changing either side)
infra/main.bicep        — SWA resource + app settings
infra/migrations/       — T-SQL to run in the Fabric portal SQL editor
.github/workflows/      — SWA deploy on push to main
staticwebapp.config.json — SPA fallback, node:20 apiRuntime, anonymous routes
```

## First-time Azure setup (one-time, ~20 minutes)

1. **Create the Fabric SQL database.** In the Fabric portal, in the same workspace as `herd-intranet`,
   create a new SQL database named **`buffolympics`** (keeping it separate from herd-intranet means
   game-day load can't slow the intranet, and vice versa — but pointing `FABRIC_SQL_DATABASE` at
   `herd-intranet` also works since every table here is prefixed `bo_`).
2. **Grant the service principal.** Reuse the `herdintranet` service principal: workspace →
   Manage access → it should already be Contributor. Then on the new DB item → ⋯ → **Manage
   permissions** → add the SP → grant **Read all data** + **Write all data**.
   (Portal-only — `CREATE USER … FROM EXTERNAL PROVIDER` is not supported on Fabric SQL.)
3. **Run the migration.** Open the SQL editor from the `buffolympics` database item and paste
   `infra/migrations/001_init.sql` (idempotent; creates all `bo_*` tables and seeds the 26 games,
   the schedule, the relay legs, and default settings including ref join code `txrhbuff2026`).
4. **Create the Static Web App.** Either:
   - `az deployment group create -g <rg> --template-file infra/main.bicep --parameters @infra/main.parameters.json`
     (copy `main.parameters.example.json` → `main.parameters.json` and fill it in — it's gitignored), or
   - Portal: create a **Static Web App** named `buffolympics-swa` (Standard), *deployment source:
     Other*, then set the app settings from the table below by hand.
5. **Wire GitHub deploys.** Get the deployment token
   (`az staticwebapp secrets list --name buffolympics-swa -g <rg>` or portal → Manage deployment token)
   and save it as the GitHub secret **`AZURE_STATIC_WEB_APPS_API_TOKEN_BUFFOLYMPICS`** on this repo.
   Push to `main` → the workflow in `.github/workflows/` deploys in ~60–90s.
   (If Azure auto-generated a second workflow file when you created the SWA, delete it — keep only ours.)
6. **Sign up as yourself.** Your email is in `ADMIN_EMAILS`, so your account becomes admin on
   sign-up — the **Admin Center** link appears in the desktop nav. Change the referee join code from
   the Referees section before sharing it.

### SWA app settings

| Setting | Value |
|---|---|
| `FABRIC_SQL_SERVER` | `…database.fabric.microsoft.com` host (same server as herd-intranet) |
| `FABRIC_SQL_DATABASE` | `buffolympics` |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | the service principal (Secret **Value**, not the ID) |
| `SESSION_SECRET` | long random string (`openssl rand -hex 48`) — rotating it signs everyone out |
| `ADMIN_EMAILS` | comma-separated emails that get admin on sign-in |

## How the event runs (admin cheat-sheet)

1. **Sign-Up phase** (default): players create accounts, pick a tribe, claim time slots up to their
   per-tribe cap (**Buffalo 4 / Texas Roadhouse 2**, no overlapping fixed-time blocks), join the
   **Dip Off** (5 cooks/tribe) and one **relay leg**.
2. Flip **Event mode → Game Day** in the Admin Center sidebar: sign-ups lock, **dip voting** opens
   on every phone (one vote each; dips stay numbered/anonymous).
3. Refs log results all day from their stations (assign refs to games in Admin → Referees).
   Team totals stay sealed — players only see their own results. Admin can **peek** privately.
4. Closing Ceremony: Admin → Scores → **Reveal scores to everyone** (confirmed, one-way), and
   Admin → Dip Off → **Reveal winner**.

## Development notes

- `docs/API.md` is the contract — update it first when changing endpoints.
- Auth token travels in the **`X-Auth-Token`** header (SWA managed Functions rewrite `Authorization`).
- One `app.http()` registration per file; every function module is `require()`d from `api/index.js`;
  `api/package.json` keeps `"main": "index.js"`. Keep API deps minimal (SWA ~15k-file deploy cap).
- Fabric SQL: no `USE`, no `GO`, no `TRUNCATE`, portal-managed SP access. See Herd-Intranet's
  CLAUDE.md gotchas — they all apply here.

## Slot-based sign-ups (migration 002)

Games sign-ups are **per time slot**, not per game. Each game (`bo_games`) has rows in
`bo_game_slots` — a 5-minute slot with a **per-team headcount** (`cap_buffalo` / `cap_roadhouse`;
`0` = that tribe isn't in that slot). Players reserve a slot for their tribe up to a **per-tribe
day cap** — **Buffalo 4 slots, Texas Roadhouse 2** (TXRH brings more people, so each Roadie takes
fewer slots to spread them around). Fixed-time games can't overlap; they can arrive anytime in the
game's window, and after it the game is free walk-up. Relay + Dip Off are separate from the cap.

**Walk-up games** (`open_play = 1`) also carry sign-up slots now: a player can lock a time inside
the game's window (e.g. Unity Circle 1:30–1:50), and **walk-up slots are allowed to overlap another
pick** (the UI warns to finish inside the window). After the window the game reverts to free
walk-up. For refs, a walk-up station shows the **signed-up roster to score** first, then a
**walk-on search** to add scores for anyone who shows up after the window.

- Data is generated from the event spreadsheet into `infra/migrations/002_slots.sql`
  (28 games, 156 slots, 7 relay legs). **Run it in the Fabric SQL editor** after `001_init.sql`.
  It creates `bo_game_slots`, reshapes `bo_signups` to `(user_id, slot_id)`, and reseeds
  games/slots/relay. It **resets existing sign-ups** — safe pre-event. The per-tribe cap is enforced
  in the API (`api/lib/bootstrap.js` → `signupMaxFor`), not the schema.
- Sign-up API: `POST /api/signups {slotId}` / `DELETE /api/signups/{slotId}`.

**Editing the lineup mid-event — use the Admin Center, not the migration.** Re-running `002` wipes
sign-ups (it drops `bo_signups` and reseeds slots with new IDs). Instead, **Admin Center → Games &
slots** lets you add/edit/remove games and time slots from the browser. Editing a time or a cap is
an `UPDATE` on a stable slot ID, so **everyone stays signed up**; deleting a slot or game only drops
that item's sign-ups. It's the safe path once people have started signing up.

### Concurrency is safe — and you can prove it

Slot capacity is enforced **atomically in the database**: the sign-up insert runs in a transaction
that takes an `UPDLOCK`/`HOLDLOCK` on the slot's `bo_game_slots` row, so simultaneous joins to the
same slot serialize and re-check capacity under the lock — no overselling, even across separate SWA
Function instances. Different slots never block each other. A player who loses the race for the last
seat gets a clean *"that slot just filled up"* 409.

To verify against the live deployment, run the included load test — it creates a throwaway game with
one capped slot, fires N simultaneous joins at it, asserts exactly `CAP` land, then deletes the test
game and every test player it created (leaves no residue):

```
BASE_URL="https://<your-swa-host>" ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="…" \
  node scripts/concurrency-loadtest.js          # optional: N=20 CAP=3
```

Run it while **Event mode = Sign-Up** (it aborts on Game Day, when sign-ups are locked). Cleanup uses
the admin `removeUser` action, which is also handy for clearing out any bogus account.

### Keeping Fabric load down

The event runs on the small **shared F2** Fabric capacity, so the read-heavy `GET /api/bootstrap`
(hit on every load and re-polled every 60s by every player) splits into a **shared block cached
in-process ~20s** (`api/lib/cache.js`) plus **2 per-user queries** that always run live. Under a
game-day crowd this collapses the shared dozen-query cost to ~3 refills/minute instead of once per
request. Writes (`{fresh:true}` on signup/dip/relay, `bustSharedBootstrap()` on results/admin/team)
bust the cache so nobody sees stale data beyond their own poll.

## Gotchas hit during setup (so the next person doesn't relearn them)

- **Fabric SQL database name:** use the **full `Initial Catalog`** value from the DB's connection
  string (`buffolympics-<guid>`) for `FABRIC_SQL_DATABASE`, not the short name — the short name
  fails login routing with "Cannot open server … The login failed."
- **Azure Functions reserves the `admin` route prefix.** Any function route starting with `admin`
  (`admin/…`, even `admin-board`) is intercepted by the Functions host and 404s. The admin API is
  under the **`ac`** prefix (`/api/ac-overview`, `/api/ac/{action}`, …) for this reason.
- **Service worker is network-first for JS/CSS** (cache-first would pin a stale `app.js` across
  deploys). Bump `CACHE` in `sw.js` when you need to force a hard refresh of cached assets.
