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

**Workflow:** work on a per-task feature branch → open a draft PR → **squash-merge to `main`** (that's
what deploys). GitHub repo: `coryzilisch-lgtm/BuffOlympics`.

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
  results/                 — POST /api/results (ref logs winner/vs/solo/walk)
  ref-claim/               — POST /api/ref-claim (ref self-assigns/releases a game)
  ac-overview/             — GET /api/ac-overview (admin dashboard payload; includes game slots)
  ac-actions/              — POST /api/ac/{action} (admin mutations; see list below)
  ac-results/, ac-dip/     — PATCH result / DELETE dip entry (admin)
  health/                  — GET /api/health (DB connectivity diagnostic)
docs/API.md                — the frontend↔backend contract (UPDATE FIRST when changing endpoints)
infra/main.bicep           — SWA resource + app settings
infra/migrations/          — T-SQL run by hand in the Fabric portal SQL editor
  001_init.sql             — all bo_* tables + seed (games, schedule, relay legs, settings)
  002_slots.sql            — GENERATED slot migration (see "Slots" below). RESETS sign-ups.
  003_idols.sql            — bo_idols table + seed (hidden-immunity clues; Admin → Idols)
  004_win_points.sql       — bo_games.win_points (per-game points a ref's winner pick awards)
  005_default_ref.sql      — one-time: set needs_ref=1 on every game (refs are the default)
  006_schedule_end.sql     — bo_schedule.end_label/end_ampm (optional start/end range on blocks)
  007_game_details.sql     — populates bo_games.descr/inventory/players/points_label (+ some
                             win_points/needs_ref) from the Minute to Win It rules doc
  008_widen_game_text.sql  — widens points_label/players to NVARCHAR(200) (007 truncated on 8
                             games at the old NVARCHAR(50)) + re-applies those 8 points_labels
scripts/
  concurrency-loadtest.js  — proves the atomic slot guard against a live deploy (Node 18+, no deps)
  loadtest-crowd.js        — realistic crowd load test: read stampede + sign-up burst + sustained
                             mix, reports latency percentiles + throttle rate, self-cleaning (see
                             docs/LOADTEST.md). Different question than the concurrency test.
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
(`refBoardScreen`) + ref self-assign tab (`refGamesScreen`), Admin Center (`adminScreen` +
`adm*Section` incl. `admIdolsSection`/`admSongsSection` + `admGamesModals`). Bracket games render a
"Bracket path" panel from the frontend `BRACKETS` config (keyed by game id — Cornhole, Ping Pong).

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

For **capacity** (not correctness) under a realistic crowd — read stampede + sign-up burst + sustained
mix, with latency percentiles + throttle rate — use `node scripts/loadtest-crowd.js` (also self-
cleaning; `USERS`/`SLOTS`/`DURATION_S`/`READ_ONLY` env knobs). Full runbook + Fabric-metrics watchlist
+ tuning levers in **`docs/LOADTEST.md`**.

---

## Fabric load — shared-bootstrap cache

The event runs on a **shared Fabric F4** capacity (double F2), and `GET /api/bootstrap` (every load,
re-polled every 60s by every player) originally ran **14 queries**. Split in `api/lib/bootstrap.js`:

- **12 shared queries** (games, slots, rosters, tribes, schedule, dip, relay, scores, announcements)
  → cached in-process **~45s** (`api/lib/cache.js`, `SHARED_KEY`; raised from 20s after the first
  crowd load test — trims cold-fill cost when SWA scales out under a burst).
- **2 per-user queries** (`myVote`, `myResults`) → always live.
- Writers bypass/refresh the cache: signup/dip/relay pass `buildBootstrap(pool, user, {fresh:true})`;
  results/admin/team call `bustSharedBootstrap()`. So the writer sees their change immediately and
  every successful signup refreshes the shared copy → headcounts stay fresh during a rush; the 45s
  TTL is just a backstop. Net: crowd DB cost drops from once-per-request to a few shared-refills/min.

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
on stable ids (sign-ups preserved); removing drops only that item's sign-ups. The game editor also
sets **"Points for a win"** (`bo_games.win_points`, migration 004) — the points a ref's winner pick
awards to the winning tribe — and **"Needs a referee"** (defaults ON; migration 005 set `needs_ref=1`
on every existing game).

---

## Full admin action list (`POST /api/ac/{action}`, admin-only)

`settings` (eventMode/refJoinCode/scoresRevealed[one-way]/dipRevealed) · `people`
(toggleAdmin/toggleRef/addGame/removeGame/**fillSlot**/**resetPassword**/**removeUser**) · `relay-legs` · `announcements` ·
`schedule` (add/remove/move/update) · **`idols`** (add/update/remove/toggleFound — hidden-immunity clues,
`bo_idols`, migration 003; hidden by default, reveal by release time or found) · `ref-assign` · `games` (see above) ·
**`reset-scores`** (clears ALL logged scores). Every `ac` action busts the
shared bootstrap cache. `removeUser` deletes a user + their sign-ups/dip/relay/ref-assignment (keeps
`bo_results`) — for clearing test/bogus accounts. `resetPassword` sets a new `password_hash` (admin-
driven reset — no email infra, so the admin sets it and tells the person). `fillSlot` drops a specific
person into a specific slot (admin override — ignores caps/overlap/mode); powers **"Fill slot"** in the
Games editor and the time-slot picker when adding someone to a game from the People tab. **`reset-scores`**
`{confirm:'RESET'}` deletes every `bo_result_history` + `bo_results` row and re-seals the board — for
wiping pre-event test data; gated behind the shared password `RESET` (never shown; the Scores tab's
danger-zone button asks for it via a browser prompt). The Admin Center → People
tab surfaces each account's shirt size + which Buff Olympics it is for them, has a 🔑 reset-password
and 🗑 delete button per person, and a **Songs** tab lists every song request with a CSV export for
the DJ.

---

## Referee experience (`refBoardScreen`, `refGamesScreen`, `ref-claim/`, `results/`)

Refs have **no tribe**, so they skip the pick-your-tribe gate (`render()` guards the gate with
`!isRefUser()`). Their world:

- **Home (`refBoardScreen`) = only the games they're assigned to.** Walk-up games are NOT auto-shown
  to every ref anymore — they're assigned like any other game (bootstrap `refStations` filters to
  `assignments[g.id] === uid`). Each station carries its `slots[]` (per-tribe rosters).
- **Games tab (`refGamesScreen`) = self-assign.** Every game with its assignment status + an "I'll ref
  it"/"Release" button → `POST /api/ref-claim {gameId, claim}` (`bo_ref_assignments` is one-ref-per-
  game, so claiming takes it over — lets refs move coverage without an admin). Powered by
  `payload.refGames`.
- **Scoring: click a game → pick the timeslot → log it.** Games run out of order, so the ref selects
  which slot they're scoring (`S.refSlot[gameId]`), sees that slot's players, and logs via
  `POST /api/results`:
  - **Head-to-head / bracket** → **winner-picker** (`type:'winner'`, `{winnerTeam, winnerName,
    scores}`). Points come from the game's `win_points` (server-authoritative). Bracket games
    (in `BRACKETS`) get a **round toggle**: "Bracket round" = within-tribe, logs advancement with
    `scores:false` (no points); "Championship" = cross-tribe, `scores:true` (awards points). So **only
    the cross-tribe championship scores**.
  - **Walk-up** → the ref **types any number** per player (`type:'solo'`), plus a walk-on search to
    score anyone not on the slot list (`type:'walk'`). No fixed value — whatever they earned.

Admin still assigns refs in **Admin → Referees** (`ref-assign`); both paths write `bo_ref_assignments`.

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
3. Refs log results all day: assign refs in Admin → Referees (or refs self-assign from their Games
   tab), then each ref taps their game → picks the timeslot → logs the winner (head-to-head/bracket)
   or types scores (walk-up). Totals stay sealed; admin can **peek** privately. Idol clues release on
   their times / get marked found in Admin → Idols.
4. Closing: Admin → Scores → **Reveal** (one-way), Admin → Dip Off → **Reveal winner**.

---

## Database tables (`bo_*`, Fabric SQL)

`bo_users` (id, first/last, username, email, pw_hash, team, is_ref, is_admin, shirt_size, years,
song_request, …) · `bo_games` (id NVARCHAR PK, name, time_label, needs_ref, venue, **open_play**,
**win_points** [004], sort, + legacy cols) · `bo_game_slots` (id IDENTITY, game_id, start_min, label,
cap_buffalo, cap_roadhouse, sort) · `bo_signups` (user_id, slot_id) PK ·
`bo_schedule` (…, **end_label/end_ampm** [006]) · `bo_relay_legs` / `bo_relay_signups` ·
`bo_dip_entries` / `bo_dip_votes` · `bo_results` / `bo_result_history` · `bo_ref_assignments`
(game_id PK — one ref per game) · `bo_idols` (title, clue, release_min, found, sort — 003) ·
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
(002 resets sign-ups — pre-event only), then `003`–`008` (idols / win_points / default-ref /
schedule-end / game details / widen game text; each idempotent, run once). Backend reads the
003–006 columns/tables **defensively** (try/catch → default), so the app still boots if a
migration hasn't been run yet — the feature just stays dormant until it is.

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

Build a Playwright stub harness in the scratchpad: a tiny static+stub-API server (`serve.js`) that
fakes `/api/bootstrap` + `/api/ac-overview` (and route-intercepts `/api/*` for ref/results payloads)
and drives the real `app.js` in headless Chromium. Use the **headless_shell** binary
(`/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` — the plain `chromium`
old-headless build is removed) via `playwright-core`; seed `localStorage.bo_token` to boot straight
into an authed session. Assert on rendered text/`data-act` buttons and captured POST bodies; note
`innerText` returns CSS-uppercased text (match case-insensitively). The stub can't reproduce DB
concurrency — that's what `scripts/concurrency-loadtest.js` is for (run against a real deploy). Always
`node --check` edited JS files.

---

## Current status (July 2026)

Live on Azure, deploy pipeline green. Foundation (earlier): walk-up sign-up slots + per-tribe caps
(4/2); Games & slots editor; shared-bootstrap cache; **atomic concurrency guard**; concurrency
load-test.

Shipped since (all merged to `main`):
- **Admin Center:** People shows shirt size + which Buff Olympics (per person); 🔑 reset-password +
  🗑 delete-player; **Songs** tab w/ CSV export; **Idols** tab (create clues, set release times, mark
  found — hidden by default); **Schedule** editor (per-block start/end times) + live Timeline built
  from real games/slots; fixed the scroll-jumping-to-top bug.
- **Team colours:** Buffalo navy/orange, TXRH red/yellow everywhere (shared `teamPill`); "Captains"
  removed.
- **Player app:** games search (mobile + desktop); removed the confusing "then walk-up"; game-day
  "earn more points" walk-up prompt; **Bracket path** panels (Cornhole/Ping Pong); Schedule weaves the
  player's own games into the shared blocks.
- **Referees:** winner-picker scoring w/ admin-set per-game `win_points`; refs default ON; walk-up
  scored by typing any number; **ref experience rework** — Home shows only assigned games, self-assign
  from the Games tab (`ref-claim`), score by picking the timeslot (games run out of order), refs skip
  the team gate.

DB migrations **003–008 have been run** in Fabric (idols / win_points / default-ref / schedule-end /
game details / widen game text). Edit the game lineup only via the admin editor — never re-run 002
(it wipes sign-ups).

Open ideas / not built: overlap indicator on the games list (grey out games that clash with an
existing pick — scoped but not built); email/notifications; richer mobile polish. Nothing blocking.
