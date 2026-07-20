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
  009_game_types.sql       — bo_games.head_to_head (ref-scoring flag) + is_bracket/bracket_intro
                             + bo_bracket_rounds table (editable brackets). Backfills head_to_head
                             (non-walk-up=1) + seeds the Cornhole/Ping-Pong brackets. RUN IN TWO
                             STEPS (Part 1 schema, then Part 2 backfill — Fabric Msg 207 gotcha).
  010_ref_mode.sql         — ref-mode redesign: bo_ref_assignments PK -> (game_id, user_id)
                             (MULTIPLE refs per game, uncapped), bo_results.slot_label/round_label
                             (green "Scored" marks + ref change-result), bo_games.round_points
                             (points per bracket-round win; champion still earns win_points),
                             bo_idols.points/found_by (admin awards an idol to its finder).
                             RUN IN TWO STEPS like 009.
  011_team_games.sql       — team games: bo_games.team_size (players/team; 1=individuals) +
                             bo_signups.team_no (which team within a slot+tribe). A slot then holds
                             Team 1 / Team 2 per tribe (players pick a teammate at sign-up), and refs
                             score whole teams. Backfills team_size=2 for Cornhole/Ping-Pong. RUN IN
                             TWO STEPS like 009. Signup atomic guard is per-(slot,tribe,team_no).
  012_bracket_engine.sql   — bracket engine: bo_game_slots.round_no/lane (slots become bracket
                             MATCHES — Round 1 seeds from sign-ups, later rounds auto-fill with
                             winners, lane 'final' = championship) + bo_results.slot_id (results pin
                             to ONE slot — fixes two same-time matches both marking Scored). RUN IN
                             TWO STEPS like 009; Part 2 backfills round 1 lanes from caps.
  013_token_version.sql    — bo_users.token_version: admin password reset bumps it, killing every
                             session token issued before the reset (tokens carry `tv`). One step.
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
"Bracket path" panel via `bracketFor(g)` — DB-backed bracket data from the payload (migration 009),
with the hard-coded `BRACKETS` const as a pre-009 fallback. Admin-editable in the bracket editor.

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
- **Team games** (`bo_games.team_size ≥ 2`, migration 011): a slot's per-tribe seats split into teams
  of `team_size` (numTeams = `floor(cap/team_size)`). The player joins a **specific** team via
  `POST /api/signups {slotId, teamNo}` — that's how partners are chosen — and `bo_signups.team_no`
  records it. The **atomic guard** counts per `(slot, tribe, team_no)` capped at `team_size` (same
  lock discipline as the individual path — don't regress it). `team_size` = 1 (default/pre-011) is
  the plain individual model. Set caps to **# teams × team_size**; the Games editor's slot form does
  this for you (asks "# teams").
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
re-polled every ~90s by every ACTIVE viewer) originally ran **14 queries**. `api/lib/bootstrap.js`
splits the identical-for-everyone data into **two independently-busted cached blocks** (both `~120s`
TTL, `api/lib/cache.js`) plus a small per-user tail:

- **ROSTER block** (`SHARED_ROSTER_KEY`) — games, slots, rosters, tribes, schedule, dip, relay,
  announcements, ref assignments + all game-config maps. Changes only on **sign-up / dip / relay /
  admin** edits.
- **RESULTS block** (`SHARED_RESULTS_KEY`) — `scores`, `leaderboard`, and the ref `refResults`
  (`TOP 2000`) scan. Changes only on **score** writes — and is **SKIPPED ENTIRELY in sign-up mode**
  (nothing scored yet → zero result queries). `refResults` is identical for every ref, so caching it
  here means one scan per refill, not one per ref per poll.
- **Why two blocks:** a write invalidates only the half it changed. During the **sign-up rush** every
  signup rebuilds rosters but never touches results; during **game day** every score calls
  `bustResultsBootstrap()` and rebuilds only the small results block, leaving the whole roster payload
  cached. `bustSharedBootstrap()` (roster/admin/team writes) busts BOTH — the safe default.
- **Per-user tail** (`myVote`, `myResults`) — the only DB cost that can't be cached (runs live per
  poll). Also **skipped in sign-up mode**: dip voting opens on Game Day and nothing is scored, so both
  are empty → **zero per-user DB work per poll during the sign-up rush.**
- The `~120s` TTL is deliberately LONGER than the ~90s client poll so a lone foregrounded reader's
  next poll hits the cache (0 shared queries) instead of refilling — the main lever against idle-tab
  CU burn. Writers pass `{fresh:true}` / bust, so headcounts + Scored marks stay fresh during a rush;
  the TTL is just a backstop for pure readers between writes.
- **Client polling** (`app.js`, bottom): a hidden/backgrounded tab never polls, AND a tab left open
  but untouched for **5 minutes pauses completely** until the person interacts or refocuses (which
  fires an immediate catch-up poll). Cadence is 90s. Both guards keep an idle phone off the F4 budget.

Each block stores raw mssql result objects and `buildBootstrap` only READS them (the one `.sort` is on
a filtered copy), so it's safe to share across users. Per-user `mine` flags are computed each call.

---

## Admin Center → Games & slots editor

Browser UI to add/edit/remove games and slots, **safe mid-event**. `admGamesSection` + modals
(`admGamesModals`) in `app.js`; handlers `admGame*` / `admSlot*` in `ACTIONS`. Time entry: type
`1:30 PM` → `parseTimeLabel`/`minToLabel` derive `start_min` + label. `ac-overview.gamesCatalog[]`
carries `slots[]` with live `nBuffalo`/`nRoadhouse` signed counts.

Backend: **`POST /api/ac/games`** (in `ac-actions/index.js`, `handleGames`):
`addGame` / `updateGame` / `removeGame` / `addSlot` / `updateSlot` / `removeSlot` /
`addRound` / `updateRound` / `removeRound`. Editing = `UPDATE`
on stable ids (sign-ups preserved); removing drops only that item's sign-ups. The game editor also
sets **"Points for a win"** (`bo_games.win_points`, migration 004) — the points a ref's winner pick
awards to the winning tribe — and **"Needs a referee"** (defaults ON; migration 005 set `needs_ref=1`
on every existing game).

**Head-to-Head + Bracket (migration 009).** The game editor has a **"Head-to-head"** toggle
(`bo_games.head_to_head`) that drives how refs score: ON → winner-picker awarding the flat
`win_points`; OFF → the ref types any number per player (variable). It's decoupled from `open_play`
(walk-up scheduling); the backfill sets non-walk-up games to head_to_head=1 so pre-009 behavior is
preserved. Refs read it via `stationType`/`refStations.type` (`'vs'` vs `'walk'`). A **"🏆 Bracket"**
button per game opens the **bracket editor** (`admBracketModal` + `admBracket*`/`admRound*` actions):
toggle `is_bracket`, edit the intro, and add/edit/remove rounds (`bo_bracket_rounds`: time/name/detail/
team). Brackets USED to be a hard-coded frontend `BRACKETS` const; it's now DB-backed and editable,
with `BRACKETS` kept only as a pre-009 fallback (`bracketFor(g)` prefers the payload). Both the
head_to_head/is_bracket/bracket_intro writes and the round table are handled **defensively** (separate
UPDATE in try/catch; round actions 409 pre-009) so the editor still works before 009 is run.

---

## Full admin action list (`POST /api/ac/{action}`, admin-only)

`settings` (eventMode/refJoinCode/scoresRevealed[re-sealable — the Scores tab has a "Re-seal scores"
undo]/dipRevealed) · `people`
(toggleAdmin/toggleRef/addGame/removeGame/**fillSlot**/**unfillSlot**/**resetPassword**/**removeUser**) · `relay-legs` · `announcements` ·
`schedule` (add/remove/move/update) · **`idols`** (add/update/remove/toggleFound — hidden-immunity clues,
`bo_idols`, migration 003; hidden by default, reveal by release time or found) · `ref-assign` · `games`
(addGame/updateGame/removeGame/addSlot/updateSlot/removeSlot + **addRound/updateRound/removeRound** —
see above) · **`reset-scores`** (clears ALL logged scores). Every `ac` action busts the
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
`!isRefUser()`). **Desktop mirrors mobile for refs** — the desktop sign-up board is player-only
(`render()` gates it with `!isRefUser()`), so refs always get the phone-column ref UI, and
`screenHtml()` routes refs away from the sign-up game detail (refs never sign up). Their world:

- **Home (`refBoardScreen`) = only the games on their list.** Walk-up games are NOT auto-shown
  to every ref — they're claimed like any other game. **Multiple refs per game, uncapped**
  (migration 010: `bo_ref_assignments` PK is `(game_id, user_id)`); bootstrap filters `refStations`
  to games whose ref list includes the caller. Each station carries `slots[]` (per-tribe rosters).
- **Games tab (`refGamesScreen`) = build your list.** Every game with everyone reffing it
  (`refNames[]`) + an "+ Add to my list"/"Remove" button → `POST /api/ref-claim {gameId, claim}`.
  Claiming adds a row (never bumps another ref); releasing removes only the caller's row.
- **Scoring: click a game → pick the timeslot → log it.** Results are tagged with
  `slotLabel`/`roundLabel` (migration 010) **and `slotId` (migration 012)** — slot-id matching is what
  lets two same-time matches score independently. A non-walk-up game whose every slot has a result
  turns **green ("All slots scored" + COMPLETE badge)** on the ref board. **Structured brackets**
  (migration 012, slots with `roundNo`/`lane`): the ref board lists each round's MATCHES — Round 1
  seeds from sign-ups, later matches show "Waiting on Round N results" until fed, then auto-populate
  with winners (`bracketMatches()` in app.js computes the progression); the championship (lane
  `'final'`) seeds from each tribe's bracket winner and awards `win_points` (rounds award
  `round_points`). Admin builds the structure in the **Bracket Builder** (Games → 🏆 Bracket →
  "Bracket matches"): per-round match rows with lane badges, add/edit/remove, round-1 caps derived
  from team size. **Walk-up matchup builder**: walk-up team games (and walk-up H2H) get a "New
  walk-up matchup" panel — pick each spot with a UNIQUE player (Buffalo side vs TXRH side), then tap
  the winner (H2H) or type each side's score. Logged walk-up entries (walk-ons + matchups) stay
  visible in a "✓ Walk-up results" panel right after the sign-up slots (with Change). `allPlayers`
  is deduped by display name+team (identical display names would read as confusing duplicate rows).
  A scored championship shows a 🏆 "Champion … +N pts awarded to <tribe>" banner; champion points
  (`win_points`) are editable in the bracket modal next to round points;
  `payload.refResults` (refs only) feeds the marks, the logged-result panels, and the bracket
  progress list. A **Change** button (warns first) `DELETE /api/results/{id}`s the row so the ref
  re-enters it. `refStations.type` from `head_to_head` (009):
  - **Head-to-head** (`type:'vs'`) → ref taps the **winning UNIT** and can log **several matchups per
    slot** (each tap is its own result). A unit is a whole **team** for team games (`teamSize ≥ 2`,
    migration 011 — from the slot's `buffaloTeams`/`roadhouseTeams`) or a single player otherwise;
    `slotUnits(slot, tribe)` builds them (`app.js`). Bracket rounds are **within-tribe** (BCI-vs-BCI,
    TXRH-vs-TXRH) and award `round_points` (010, 0 = advancement-only) via `stage:'round'`; the
    championship is cross-tribe and awards `win_points`. The **Bracket progress** list shows each
    round's logged winners and populates the next round. Walk-up H2H stations show a "find someone
    from the other tribe" note.
  - **Not head-to-head** (`type:'walk'`) → ref enters **one score per PERSON** (each logged separately
    as `type:'solo'`); already-scored people drop off until Changed. The "score anyone not on the
    list" walk-on search now shows **only for walk-up (`open_play`) games**, not every variable game.

Admin still adds/removes refs in **Admin → Referees** — every game row has a **"+ Add ref"** button
opening a search over ALL people (not just existing refs); picking a non-ref **auto-promotes** them
to `is_ref=1` server-side (`ref-assign` `{gameId,userId,op}`). Both paths write `bo_ref_assignments`.

---

## Auth

Custom email/password (NOT Entra). Token = HMAC-signed session string in the **`X-Auth-Token`**
header. `api/lib/auth.js`: `requireUser` (verifies token → user row), `requireRef`, `requireAdmin`,
`formatName(first,last,username)`, `userToJson`, `json(body,status)`.

- Players: `POST /api/auth/signup {firstName,lastName,email,password,team,...}` (team required) /
  `signin {email,password}`.
- Refs: `ref-create` takes the SAME profile fields as a player signup minus the tribe
  ({firstName,lastName,email,password,joinCode,shirtSize,…}; default code `txrhbuff2026`,
  admin-editable) — the account then signs in via the normal email `signin`. Legacy
  username-only ref accounts still work via `ref-login`.
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
**win_points** [004], **head_to_head/is_bracket/bracket_intro** [009], sort, + legacy cols) ·
`bo_game_slots` (id IDENTITY, game_id, start_min, label,
cap_buffalo, cap_roadhouse, sort) · `bo_signups` (user_id, slot_id) PK ·
`bo_schedule` (…, **end_label/end_ampm** [006]) · `bo_relay_legs` / `bo_relay_signups` ·
`bo_dip_entries` / `bo_dip_votes` · `bo_results` / `bo_result_history` · `bo_ref_assignments`
(game_id PK — one ref per game) · `bo_idols` (title, clue, release_min, found, sort — 003) ·
**`bo_bracket_rounds`** (id IDENTITY, game_id, sort, time_label, name, detail, team — 009; editable
bracket rounds) · `bo_announcements` · `bo_settings` (key/value: event_mode, ref_join_code,
scores_revealed, dip_revealed).

---

## Deploy & app settings

Push to `main` → GitHub Actions (`.github/workflows/azure-static-web-apps.yml`) → SWA (~60–90s).
GitHub secret: **`AZURE_STATIC_WEB_APPS_API_TOKEN_BUFFOLYMPICS`**. `staticwebapp.config.json` needs
`"platform":{"apiRuntime":"node:20"}` and SPA fallback.

SWA app settings: `FABRIC_SQL_SERVER`, `FABRIC_SQL_DATABASE`, `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET` (SP; Secret **Value** not ID), `SESSION_SECRET`, `ADMIN_EMAILS`.

Migrations run **by hand** in the Fabric portal SQL editor: `001_init.sql` then `002_slots.sql`
(002 resets sign-ups — pre-event only), then `003`–`009` (idols / win_points / default-ref /
schedule-end / game details / widen game text / **game types + brackets**; each idempotent, run once —
**009 runs in TWO steps**, Part 1 schema then Part 2 backfill, per the Fabric Msg 207 gotcha). Backend
reads the 003–009 columns/tables **defensively** (try/catch → default), so the app still boots if a
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
  "earn more points" walk-up prompt; **Score Room leaderboard** — top-10 scorers per tribe (from
  `payload.leaderboard`, shared-cached; pair results rank as the pair) + a "#N Your rank in <tribe>"
  chip for the caller; individual points only, team totals stay sealed; **Bracket path** panels (Cornhole/Ping Pong); Schedule weaves the
  player's own games into the shared blocks.
- **Referees:** winner-picker scoring w/ admin-set per-game `win_points`; refs default ON; walk-up
  scored by typing any number; **ref experience rework** — Home shows only assigned games, self-assign
  from the Games tab (`ref-claim`), score by picking the timeslot (games run out of order), refs skip
  the team gate.
- **Ref mode redesign (migration 010):** desktop refs mirror the mobile UI; multiple refs per game
  (uncapped, add-to-my-list model); winner picked as a whole TEAM; variable games scored one number
  per team; green **Scored ✓** marks + logged-result panels + warn-first **Change result**
  (`DELETE /api/results/{id}`); bracket rounds award admin-set `round_points` (champion earns
  `win_points`) and the bracket progress list populates the next round with logged winners.
  **Plus:** idols carry points + an admin 🏆 Award-to-finder flow (auto-logs the tribe points);
  walk-up head-to-head note (player + ref); dip cooks get an 11:30 AM Cafe drop-off on their
  schedule; home hero says "Welcome back, FIRSTNAME" / "Buff Olympics." (date removed); home cards
  reflect all-slots-picked / relay-leg / dip-full state; "Herd Games" → "Buff Olympics".

DB migrations **003–008 have been run** in Fabric (idols / win_points / default-ref / schedule-end /
game details / widen game text). **009 (game types + brackets), 010 (ref mode), 011 (team games),
and 012 (bracket engine) must still be run** — each in two steps, Part 1 then Part 2. Pre-012 there
are no structured brackets (legacy round/champ tabs) and results match slots by LABEL — so two
same-time matches will both show Scored until 012 is run. Until they are, the backend stays
defensive: pre-009 refs fall back to the old open_play-derived scoring + the hard-coded `BRACKETS`;
pre-010 only one ref per game can claim (second claim 409s), results aren't slot-tagged (no Scored
marks), bracket rounds stay advancement-only, and idol points stay dormant; **pre-011 every game is
an individual game** (`team_size` defaults to 1, `team_no` ignored) — the team sign-up/scoring UI
only appears once a game's `team_size` is set to ≥2 (run 011, then set it in the Games editor). Edit
the game lineup only via the admin editor — never re-run 002 (it wipes sign-ups).

Bug-sweep invariants (July 2026 audit — don't regress): game NAMES are unique and a rename carries
`bo_results.game_name` along (results/ref state key on name; points lookups prefer `gameId`);
tribe privacy is enforced SERVER-side (players' bootstrap strips the other tribe's slot rosters);
game-day locks cancels/leaves too (signups DELETE, relay DELETE); dip/relay joins use the same
atomic UPDLOCK guard as slots; `refResults` caps at TOP 2000 (never lower it — absent rows read as
"unscored" and refs re-log points); `insertResult` falls back ONLY on SQL error 207 (missing
column); per-person games count a slot Scored only when EVERY player is scored; pair results
("A & B") credit both members in myResults/leaderboard; team membership in the sign-up UI comes
from `slot.myTeamNo` (identity), not display-name matching; **resetPassword bumps
`bo_users.token_version` (migration 013)** — tokens carry `tv` and every session from before the
reset dies (defensive pre-013: reset works, old sessions just survive); **namesake twins** each get
their own occurrence-keyed (`name#k`) score row on the per-person ref board and completeness is
count-based, so one result can't mark two same-named players done (result rows still store names,
so attribution between twins is by order — totals stay right).

Open ideas / not built: overlap indicator on the games list (grey out games that clash with an
existing pick — scoped but not built); email/notifications; richer mobile polish. Nothing blocking.
