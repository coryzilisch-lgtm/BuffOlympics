# Buff Olympics — Claude Code Context

## What this is

The event app for **Buff Olympics — The Herd Games (August 14, 2026)**. Two tribes — **Buffalo** and
**Texas Roadhouse (TXRH / "roadhouse")** — sign up for game time-slots, cook for the Dip Off, claim a
relay leg, and follow the day. **SUP refs** log scores from their phones; **admins** run the event
from a desktop Admin Center. Team totals stay **sealed** until an admin reveals them at the Closing
Ceremony. It's a **PWA** — installable on a phone home screen.

Built from a Claude Design HTML/CSS/JS mockup, recreated as a vanilla-JS SPA on the **same Azure
stack as Herd-Intranet** (that repo is in the session for reference): **Azure Static Web Apps** (SPA
+ managed **Azure Functions**, Node 20) with a **Microsoft Fabric SQL Database**. All tables are
prefixed `bo_`.

Because TXRH teammates are outside the Buffalo Entra tenant, the app uses its **own email/password
accounts** (PBKDF2 + HMAC session tokens) — **not** Entra SSO. Refs create accounts with a **join
code** the admin controls.

**Deployment branch:** `claude/zip-app-azure-deploy-91df1l` (feature branch; squash-merge PRs to
`main`). GitHub repo: `coryzilisch-lgtm/BuffOlympics`.

---

## Repo layout

```
/                          — SPA: index.html, app.js (all logic), styles.css — vanilla JS, NO build step
manifest.webmanifest       — PWA manifest
sw.js                      — service worker (network-first for .js/.css; CACHE bump forces refresh)
assets/                    — brand logos + fonts (BN Kragen, Montserrat)
icons/                     — PWA + favicon icons
api/                       — Azure Functions v4 (Node 20, app.http model, mssql)
  index.js                 — explicit entry: require()s every function module ("main":"index.js")
  package.json             — "main": "index.js"; keep deps minimal (SWA ~15k-file deploy cap)
  lib/
    db.js                  — Fabric SQL pool (mssql, SP-secret auth); pool idleTimeout 5min
    auth.js                — token verify, requireUser/requireRef/requireAdmin, formatName, json()
    bootstrap.js           — buildBootstrap() + SHARED-block cache + signupMaxFor + helpers
    cache.js               — tiny per-instance TTL cache (get/set/bust)
  auth/                    — POST /api/auth/{signup,signin,ref-login,ref-create}
  me/, me-team/            — GET /api/me, POST /api/me/team
  bootstrap/               — GET /api/bootstrap (the whole payload)
  signups/                 — POST/DELETE /api/signups/{slotId?} (ATOMIC capacity guard)
  dip/, dip-vote/          — Dip Off enter/leave + vote
  relay/                   — relay leg join/leave
  scores/                  — GET /api/scores (sealed unless revealed; ?peek=1 for admin)
  results/                 — POST /api/results (ref logs vs/solo/walk)
  ac-overview/             — GET /api/ac-overview (admin dashboard payload; includes game slots)
  ac-actions/              — POST /api/ac/{action} (admin mutations; see list below)
  ac-results/, ac-dip/     — PATCH result / DELETE dip entry (admin)
  health/                  — GET /api/health (DB connectivity diagnostic)
docs/API.md                — the frontend↔backend contract (UPDATE FIRST when changing endpoints)
infra/main.bicep           — SWA resource + app settings
infra/migrations/          — T-SQL run by hand in the Fabric portal SQL editor
  001_init.sql             — all bo_* tables + seed (games, schedule, relay legs, settings)
  002_slots.sql            — GENERATED slot migration (see "Slots" below). RESETS sign-ups.
scripts/
  concurrency-loadtest.js  — proves the atomic slot guard against a live deploy (Node 18+, no deps)
.github/workflows/azure-static-web-apps.yml  — deploy on push to main
staticwebapp.config.json   — SPA fallback, node:20 apiRuntime, anonymous API routes
```

There is **no build step** — `app.js`/`index.html`/`styles.css` are served as-is. `api/node_modules`
is committed-ish via `npm ci` in CI; keep API deps tiny.

---

## Frontend architecture (`app.js`)

Single IIFE, vanilla JS, hash routing (`#/home`, `#/games`, `#/game/{id}`, `#/admin`, …). Full
`innerHTML` re-render on every state change, with focus/caret + scroll preserved across re-renders.

- **`S`** — the one global state object (top of file): `token`, `boot` (bootstrap payload),
  `overview` (admin payload), route, form store `S.f`, admin editor state (`admGameEdit`,
  `admSlotEdit`), ref board state, etc.
- **`render()`** — rebuilds `#app` from `S`. `screenHtml()` dispatches by `S.route`.
- **Event delegation**: `data-act="name"` on a clickable → `ACTIONS.name(el, e)`. Inputs use
  `data-field="key"` (writes `S.f[key]`), `data-live` (writes + re-renders), `data-debounce`.
- **`api(path, {method, body})`** — fetch wrapper; sends the session token in the **`X-Auth-Token`**
  header (SWA managed Functions rewrite `Authorization`, so a Bearer header won't work).
- **`guarded(fn)`** — wraps mutations (busy-lock + toast on error).
- Desktop (`≥940px`, `S.isDesk`) gets richer layouts: `deskGamesScreen()`, the Admin Center.
- Mobile-first; PWA installable.

Key UI areas: player games list/detail (`gamesScreen`, `gameDetailScreen`, `slotRowHtml`), ref board
(`refBoardScreen`), Admin Center (`adminScreen` + `adm*Section` + `admGamesModals`).

---

## Sign-up model — SLOTS (migration 002)

Sign-ups are **per time slot**, not per game. Each `bo_games` row has rows in `bo_game_slots`
(`id` IDENTITY, `game_id`, `start_min` = minutes since midnight, `label` e.g. `'1:30 PM'`,
`cap_buffalo`, `cap_roadhouse`, `sort`). `bo_signups` is `(user_id, slot_id)` PK.

- **Per-tribe day cap** (NOT in the schema — enforced in code, `api/lib/bootstrap.js` →
  `signupMaxFor`): **Buffalo = 4 slots, Texas Roadhouse = 2** (TXRH brings more people, so each takes
  fewer slots). `payload.signupMax` carries the caller's cap; the frontend reads `boot.signupMax`
  (never hard-code 2).
- **Fixed-time games** (`open_play = 0`) can't have two overlapping picks.
- **Walk-up games** (`open_play = 1`) ALSO carry sign-up slots now: reserve a time in the window; the
  game reverts to free walk-up after. **Walk-up slots MAY overlap another pick** (frontend shows a
  yellow "finish inside the window" warning; the signup API skips the overlap check for open_play).
- Relay + Dip Off are separate from the slot cap.
- **Sign-up API:** `POST /api/signups {slotId}` / `DELETE /api/signups/{slotId}`.

### 002_slots.sql is a RESEED — never re-run it mid-event

It `DROP`s `bo_signups` and `DELETE`s+reseeds `bo_game_slots` (new IDENTITY ids), so re-running it
**wipes all sign-ups**. Safe only pre-event. To edit the lineup once people have signed up, use the
**Admin Center → Games & slots** editor (below) or targeted `UPDATE`/`INSERT`/`DELETE` — an `UPDATE`
on a stable slot id preserves sign-ups; deleting a slot/game drops only that item's sign-ups.

002 is generated from `Games_Lay_Out.xlsx`. Current data: 28 games, **156 slots**, 7 relay legs.
Walk-up games (`open_play=1`): Unity Circle, Totem Tower, Hook & Ring, Name that Song, Suck it up,
State of Affairs, Alliance Lift, Firekeepers Puzzle. "What's Lurking?" starts 1:30 PM.

---

## Concurrency — the atomic capacity guard (CRITICAL, don't regress)

Multiple people sign up at once. The **capacity check is enforced in the DB atomically** in
`api/signups/index.js`: the insert runs in a transaction that takes `WITH (UPDLOCK, HOLDLOCK)` on the
slot's `bo_game_slots` row, re-counts under the lock, and inserts only if there's room. This
serializes concurrent joins to the **same** slot (different slots never contend), holds **across
separate SWA Function instances** (lock is server-side, not in JS), and is deadlock-free (one row
lock per request). A racer who loses gets a friendly `409 "that slot just filled up"`.

**Do NOT "optimize" this back into a JS-level `SELECT COUNT` then `INSERT`** — that's the exact race
that oversells slots (worst on cap-1 walk-up slots). Works on Fabric SQL DB even with RCSI on, because
explicit `UPDLOCK`/`HOLDLOCK` still take real locks.

**Proof:** `node scripts/concurrency-loadtest.js` (env: `BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
optional `N`/`CAP`). Creates a throwaway capped slot, fires N simultaneous joins, asserts exactly CAP
land, cross-checks the DB count, then deletes the test game + all test players. Run while Event
mode = Sign-Up. Validated to report PASS on the atomic server and FAIL on a racy one.

---

## Fabric load — shared-bootstrap cache

The event runs on the small **shared Fabric F2** capacity, and `GET /api/bootstrap` (every load,
re-polled every 60s by every player) originally ran **14 queries**. Split in `api/lib/bootstrap.js`:

- **12 shared queries** (games, slots, rosters, tribes, schedule, dip, relay, scores, announcements)
  → cached in-process **~20s** (`api/lib/cache.js`, `SHARED_KEY`).
- **2 per-user queries** (`myVote`, `myResults`) → always live.
- Writers bypass/refresh the cache: signup/dip/relay pass `buildBootstrap(pool, user, {fresh:true})`;
  results/admin/team call `bustSharedBootstrap()`. So the writer sees their change immediately and
  every successful signup refreshes the shared copy → headcounts stay fresh during a rush; the 20s
  TTL is just a backstop. Net: crowd DB cost drops from once-per-request to ~3 shared-refills/min.

The cache stores raw mssql result objects and `buildBootstrap` only READS them (the one `.sort` is on
a filtered copy), so it's safe to share across users. Per-user `mine` flags are computed each call.

---

## Admin Center → Games & slots editor

Browser UI to add/edit/remove games and slots, **safe mid-event**. `admGamesSection` + modals
(`admGamesModals`) in `app.js`; handlers `admGame*` / `admSlot*` in `ACTIONS`. Time entry: type
`1:30 PM` → `parseTimeLabel`/`minToLabel` derive `start_min` + label. `ac-overview.gamesCatalog[]`
carries `slots[]` with live `nBuffalo`/`nRoadhouse` signed counts.

Backend: **`POST /api/ac/games`** (in `ac-actions/index.js`, `handleGames`):
`addGame` / `updateGame` / `removeGame` / `addSlot` / `updateSlot` / `removeSlot`. Editing = `UPDATE`
on stable ids (sign-ups preserved); removing drops only that item's sign-ups.

---

## Full admin action list (`POST /api/ac/{action}`, admin-only)

`settings` (eventMode/refJoinCode/scoresRevealed[one-way]/dipRevealed) · `people`
(toggleAdmin/toggleRef/addGame/removeGame/**removeUser**) · `relay-legs` · `announcements` ·
`schedule` (add/remove/move/update) · `ref-assign` · `games` (see above). Every `ac` action busts the
shared bootstrap cache. `removeUser` deletes a user + their sign-ups/dip/relay/ref-assignment (keeps
`bo_results`) — for clearing test/bogus accounts.

---

## Auth

Custom email/password (NOT Entra). Token = HMAC-signed session string in the **`X-Auth-Token`**
header. `api/lib/auth.js`: `requireUser` (verifies token → user row), `requireRef`, `requireAdmin`,
`formatName(first,last,username)`, `userToJson`, `json(body,status)`.

- Players: `POST /api/auth/signup {firstName,lastName,email,password,team,...}` (team required) /
  `signin {email,password}`.
- Refs: `ref-create {username,password,joinCode}` (default code `txrhbuff2026`, admin-editable) /
  `ref-login`.
- `ADMIN_EMAILS` app setting = comma-separated emails that get `is_admin` on sign-in.
- **Admins are NOT refs.** `isRefUser()` in app.js = `!!(u && u.isRef)` only. Admins use the desktop
  Admin Center; refs use the ref board on their phone. Keep them distinct.

---

## Event flow (admin cheat-sheet)

1. **Sign-Up phase** (default): players create accounts, pick a tribe, claim slots (Buffalo 4 / TXRH
   2), join Dip Off (5 cooks/tribe), claim one relay leg.
2. Admin flips **Event mode → Game Day**: sign-ups lock, dip **voting** opens (one vote each).
3. Refs log results all day (assign refs to games in Admin → Referees). Totals stay sealed; admin can
   **peek** privately.
4. Closing: Admin → Scores → **Reveal** (one-way), Admin → Dip Off → **Reveal winner**.

---

## Database tables (`bo_*`, Fabric SQL)

`bo_users` (id, first/last, username, email, pw_hash, team, is_ref, is_admin, …) ·
`bo_games` (id NVARCHAR PK, name, time_label, needs_ref, venue, **open_play**, sort, + legacy cols) ·
`bo_game_slots` (id IDENTITY, game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) ·
`bo_signups` (user_id, slot_id) PK · `bo_schedule` · `bo_relay_legs` / `bo_relay_signups` ·
`bo_dip_entries` / `bo_dip_votes` · `bo_results` / `bo_result_history` · `bo_ref_assignments` ·
`bo_announcements` · `bo_settings` (key/value: event_mode, ref_join_code, scores_revealed,
dip_revealed).

---

## Deploy & app settings

Push to `main` → GitHub Actions (`.github/workflows/azure-static-web-apps.yml`) → SWA (~60–90s).
GitHub secret: **`AZURE_STATIC_WEB_APPS_API_TOKEN_BUFFOLYMPICS`**. `staticwebapp.config.json` needs
`"platform":{"apiRuntime":"node:20"}` and SPA fallback.

SWA app settings: `FABRIC_SQL_SERVER`, `FABRIC_SQL_DATABASE`, `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET` (SP; Secret **Value** not ID), `SESSION_SECRET`, `ADMIN_EMAILS`.

Migrations run **by hand** in the Fabric portal SQL editor: `001_init.sql` then `002_slots.sql`
(002 resets sign-ups — pre-event only).

---

## Hard-won gotchas (all apply here)

- **`FABRIC_SQL_DATABASE` must be the full `Initial Catalog`** (`buffolympics-<guid>`), not the short
  name — short name fails login routing with "Cannot open server … The login failed." (`/api/health`
  diagnoses DB connectivity.)
- **Azure Functions reserves the `admin` route prefix.** Any route starting `admin` (even
  `admin-board`) 404s. The admin API lives under **`ac`** (`/api/ac-overview`, `/api/ac/{action}`).
  SWA also **wedges a function name** to 404 once it deploys with a conflicting route — fix by
  renaming folder + function name + route together.
- **`X-Auth-Token`, not `Authorization`** — SWA managed Functions rewrite the `Authorization` header.
- **Fabric SQL: no `USE`, no `GO`, no `TRUNCATE`** (use `DELETE FROM`). Batches are parsed up front,
  so `ALTER TABLE` + referencing the new column in the same batch fails (Msg 207) — split into two
  executions, or reuse an existing column (why 002 uses `time_label`, not a new `runtime_label`).
- **One `app.http()` per file**; add new functions by creating `api/<name>/index.js` AND adding
  `require('./<name>/index');` to `api/index.js`.
- **SWA ~15k-file deploy cap** — "Failure during content distribution." Keep `api` deps minimal;
  prefer `fetch` over heavy SDKs.
- **Service worker is network-first for JS/CSS**; bump `CACHE` in `sw.js` to force a hard refresh.
- Portal-managed SP access for Fabric SQL (`CREATE USER … FROM EXTERNAL PROVIDER` not supported at
  GA). See Herd-Intranet CLAUDE.md for the full recovery story — those gotchas all apply.

---

## Verifying changes (no live Fabric in the dev sandbox)

There's a Playwright stub harness for the SPA under a scratchpad (`fe-test/serve2.js` + `test2.js`):
it fakes the API and drives the real `app.js` in headless Chromium (`/opt/pw-browsers/chromium`) to
catch runtime/console errors across the signup, walk-up, ref, and admin-editor flows. The stub can't
reproduce DB concurrency — that's what `scripts/concurrency-loadtest.js` is for (run against a real
deploy). Always `node --check` edited JS files.

---

## Current status (July 2026)

Live on Azure, deploy pipeline green. Done this session and on the deploy branch (not yet merged to
`main` at time of writing — **merge to deploy**): walk-up sign-up slots + per-tribe caps (4/2) +
What's-Lurking time shift; Admin Center Games & slots editor; shared-bootstrap cache; **atomic
concurrency guard**; `removeUser` admin action; concurrency load-test script.

**Before real sign-ups:** re-run `002_slots.sql` once in the Fabric portal (picks up walk-up slots +
the time shift). After that, edit the lineup only via the admin editor — never re-run 002.

Open ideas / not built: edit/delete company schedule entries polish, email/notifications, richer
mobile polish. Nothing blocking.
