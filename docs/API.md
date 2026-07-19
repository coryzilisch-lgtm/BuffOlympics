# Buff Olympics — API Contract

Single source of truth for the frontend ↔ backend interface. The backend is Azure Static Web Apps
**managed Functions** (Node 20, `app.http()` v4 model) reading/writing a **Fabric SQL Database**
via the `mssql` driver with service-principal auth (same pattern as Herd-Intranet).

## Conventions

- All endpoints live under `/api/`. SWA-level auth is **anonymous** — this app has external users
  (Texas Roadhouse), so we use our own email/password auth, NOT Entra.
- Auth token is sent in the **`X-Auth-Token`** custom header (NOT `Authorization` — SWA managed
  Functions rewrite the Authorization header).
- Token format: `base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, SESSION_SECRET))`
  where payload = `{ "uid": <int>, "exp": <unix seconds> }`. 30-day expiry. `SESSION_SECRET` is an
  SWA app setting.
- Passwords: PBKDF2-SHA256, 100k iterations, 16-byte random salt, stored as `pbkdf2$100000$<saltB64>$<hashB64>`.
  Use `crypto.timingSafeEqual` for comparisons (including the ref join code).
- All handlers return JSON. Errors: `{ "error": "<human message>" }` with 400/401/403/404/409 status.
- Every response includes `Cache-Control: no-store` unless noted.
- Admin bootstrap: SWA app setting `ADMIN_EMAILS` = comma-separated emails (case-insensitive).
  On signup AND signin, if the user's email is in the list, ensure `is_admin = 1`.
- Role model: `user.isAdmin` (bit), `user.isRef` (bit). Admins can do everything refs can.

## User object (returned by auth endpoints, /api/me, /api/bootstrap)

```json
{
  "id": 12, "email": "jordan@x.com", "username": null,
  "firstName": "Jordan", "lastName": "Lee", "name": "Jordan L.",
  "team": "buffalo",            // 'buffalo' | 'roadhouse' | null
  "shirtSize": "M", "years": "1st", "songRequest": "…",
  "isRef": false, "isAdmin": false
}
```
`name` is computed server-side: `firstName + ' ' + lastName[0] + '.'` (or `username` for refs with no name).

## Endpoints

### Auth (anonymous)
| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/signup` | `{firstName,lastName,email,password,team,shirtSize,years,songRequest}` | `{token,user}`. 409 if email exists. team required ('buffalo'\|'roadhouse'). |
| `POST /api/auth/signin` | `{email,password}` | `{token,user}` or 401. |
| `POST /api/auth/ref-login` | `{username,password}` | `{token,user}` or 401. Only users with `is_ref=1` or username-based accounts. |
| `POST /api/auth/ref-create` | `{firstName,lastName,email,password,joinCode,shirtSize?,years?,songRequest?}` | `{token,user}`. Same profile fields as a player signup, minus the tribe (refs are neutral); the account signs back in via the normal `signin`. 403 `{error:'bad_code'}` if joinCode doesn't match the `ref_join_code` setting (case-insensitive). 409 if the email exists. Creates user with `is_ref=1`, no team. Legacy fallback: a body with only `{username,password,joinCode}` still creates a username-based ref (signs in via `ref-login`). |

### Session'd (require X-Auth-Token; 401 otherwise)
| Method & path | Body | Notes |
|---|---|---|
| `GET /api/me` | — | `{user}` |
| `POST /api/me/team` | `{team}` | Set/switch my tribe. Returns `{user}`. |
| `GET /api/bootstrap` | — | Everything the app needs — see shape below. |
| `POST /api/signups` | `{slotId, teamNo?}` | Sign me up for a time slot. Server enforces: event_mode='signup', slot exists, my tribe has room in that slot (`cap_buffalo`/`cap_roadhouse`), not already in, **per-tribe day cap** (Buffalo **4** / Texas Roadhouse **2**, via `signupMaxFor`), and **no overlapping fixed-time slots** — walk-up (`open_play`) slots are exempt and MAY overlap. **Team games** (`bo_games.team_size ≥ 2`, migration 011): the tribe's seats are split into teams of `team_size` (numTeams = `floor(cap/team_size)`), so `teamNo` (1..numTeams) is **required** — that's how partners are chosen. The atomic capacity guard is scoped to `(slot, tribe, team_no)` capped at `team_size` (same UPDLOCK/HOLDLOCK discipline as the individual path). Errors: 409 `{error:'…'}` with message. Returns fresh `{bootstrap}` payload. |
| `DELETE /api/signups/{slotId}` | — | Cancel. Returns `{bootstrap}`. |
| `POST /api/dip` | `{action:'enter'|'leave'}` | Sign-up phase only. Max 5 cooks per tribe. One entry per user. Returns `{bootstrap}`. |
| `POST /api/dip/vote` | `{entryId}` | Game-day only. Upserts my one vote. Returns `{bootstrap}`. |
| `POST /api/relay` | `{legId}` | Join/switch (removes me from any other leg). Cap per team per leg. Sign-up phase only. Returns `{bootstrap}`. |
| `DELETE /api/relay` | — | Leave my leg. Returns `{bootstrap}`. |
| `GET /api/scores` | — | `{revealed:false}` OR `{revealed:true, buffalo:245, roadhouse:228}`. Admin may pass `?peek=1` to see totals while unrevealed → `{revealed:false, peek:true, buffalo, roadhouse}`. |

### Ref+ (require isRef or isAdmin)
| Method & path | Body |
|---|---|
| `POST /api/ref-claim` | `{gameId, claim:true|false}` — the ref adds the game to their list (`claim:true`) or drops it (`claim:false`, removes only their own row). **Multiple refs per game, uncapped** (migration 010: `bo_ref_assignments` PK is `(game_id, user_id)`); claiming never bumps another ref. Pre-010 a claim on a game another ref holds 409s. Returns fresh `{bootstrap}`. |
| `POST /api/results` | Every slot-scoped type also accepts **`slotId`** (migration 012) — stored in `bo_results.slot_id` so the result pins to ONE slot even when two matches share a time label (two 1:30 bracket matches). One of:<br>`{type:'winner', gameName, gameId?, winnerTeam:'buffalo'|'roadhouse', winnerName?, scores?, stage?, slotId?, slotLabel?, roundLabel?}` (`gameId` preferred for the points lookup — names are mutable) → ref picks the winning **team** of a head-to-head / bracket match. Points are server-authoritative: `stage:'round'` (within-tribe bracket round) awards the game's `round_points` (migration 010; 0/NULL = advancement only, `pts=0` like before); otherwise `scores:true` awards `win_points` (championship / plain head-to-head) and `scores:false` logs advancement with `pts=0`.<br>`{type:'vs', gameName, ptsBuffalo, ptsRoadhouse, slotLabel?}` (LEGACY — the current ref UI scores per person via `type:'solo'`; kept for compatibility) → one result row, winner = higher side, `pts = max`, detail `"Buffalo B – R Roadhouse"` — used for **variable-score team slots** (ref types one score per team).<br>`{type:'solo', gameName, entries:[{name, team, score}], slotLabel?}` → one row per entry with score>0, winner=team, pts=score, detail `"<name> scored <n>"`, `player_name` set.<br>`{type:'walk', gameName, playerName, team, score}` → one row like solo.<br>`slotLabel`/`roundLabel` (migration 010, stored best-effort) tag the result to a timeslot / bracket round so the ref UI can mark them **Scored ✓**. Each row records `pts_buffalo`/`pts_roadhouse` contributions and `entered_by` = caller's name. Returns `{ok:true}`. |
| `DELETE /api/results/{id}` | Ref+ deletes a logged result (and its edit history) so it can be re-entered — powers the ref "Change result" flow (the UI warns first). Returns `{ok:true}`, 404 if gone. |

### Admin (require isAdmin)
| Method & path | Body / returns |
|---|---|
| `GET /api/admin/overview` | See shape below. |
| `POST /api/admin/settings` | Any of `{eventMode:'signup'|'gameday', refJoinCode:'…', scoresRevealed:true|false, dipRevealed:true|false}`. `scoresRevealed:false` re-seals a revealed board (the Scores tab's "Re-seal scores" undo — the frontend double-confirms both directions). Returns `{settings}`. |
| `POST /api/admin/people` | `{userId, action:'toggleAdmin'|'toggleRef'|'addGame'|'removeGame'|'fillSlot'|'unfillSlot'|'resetPassword'|'removeUser', gameId?, slotId?, password?}`. addGame/removeGame manage that user's `bo_signups` rows (admin override: ignores caps/limits/mode; addGame drops them into the game's earliest slot). `fillSlot` puts the user in a **specific** slot (`slotId`) — admin override, ignores caps/overlap/mode — powering "Fill slot" in the Games editor and the time-slot picker when adding someone to a game from the People tab. `unfillSlot` pulls the user OUT of a specific slot (`slotId`) — the reverse of `fillSlot`; powers the slot roster chips in the Games editor. `resetPassword` sets a new `password_hash` from `password` (min 4 chars) — admin-driven reset for anyone who forgets theirs (no email infra; admin tells them in person). `removeUser` deletes the user + their sign-ups/dip/relay/ref-assignment (keeps logged `bo_results` history) — used for clearing test/bogus accounts. Returns `{ok:true}`. |
| `PATCH /api/admin/results/{id}` | `{pts}` — updates row pts (recompute team contribution toward the winner side), pushes previous value into `bo_result_history`, sets `edited_by`. Returns `{ok:true}`. |
| `DELETE /api/admin/dip/{entryId}` | Remove a dip entry (+ its votes). `{ok:true}` |
| `POST /api/admin/relay-legs` | `{legId, name?, capDelta?}` (cap min 1). `{ok:true}` |
| `POST /api/admin/announcements` | `{title, body}` → `{ok:true}` |
| `POST /api/admin/schedule` | `{action:'add'}` (appends "New Block" 5:00 PM), `{action:'remove', id}`, `{action:'move', id, dir:-1|1}`, `{action:'update', id, timeLabel?, ampm?, title?, place?, kind?, endLabel?, endAmpm?}` (`endLabel`/`endAmpm` = optional end time, migration 006; empty clears it back to no end). `{ok:true}` |
| `POST /api/admin/ref-assign` | `{gameId, userId, op?}` — multi-ref (migration 010): `op:'add'` (default when userId set) adds that ref to the game, `op:'remove'` removes them; `userId` null/'' clears **all** refs from the game. Adding someone who isn't a ref **auto-promotes them** (`is_ref=1` — an assignment without the flag would be invisible to them); response includes `promoted:true` when that happened. `{ok:true, promoted?}` |
| `POST /api/ac/reset-scores` | `{confirm}` — clears ALL logged scores. Requires `confirm === 'RESET'` (shared password the admin types; never shown in the UI — a wrong/missing value returns 403). Deletes every `bo_result_history` then `bo_results` row and re-seals the board (`scores_revealed = '0'`). For wiping pre-event test data; can't be undone. Returns `{ok:true}`. |
| `POST /api/ac/idols` | Idol clues (hidden-immunity), table `bo_idols` (migration 003; `found_by`/`points` migration 010). `{action:'add'}` (appends blank "New clue"), `{action:'update', id, title?, clue?, releaseMin?, points?}` (`releaseMin` = minutes since midnight, event-local; `null`/'' = stays hidden; `points` = what finding this idol is worth), `{action:'award', id, userId}` — marks the idol found by that person AND logs a `bo_results` row awarding the idol's `points` to their tribe (`game_name='Hidden Idol'`, `player_name` = finder), `{action:'toggleFound', id}` (manual toggle; un-finding clears `found_by` but does NOT remove an awarded result — edit it in Scores), `{action:'remove', id}`. `{ok:true}`. Clues are HIDDEN by default; a clue reveals once its `releaseMin` passes on the viewer's clock or it's marked found. |
| `POST /api/ac/games` | Games + slots CRUD, **safe mid-event** (edits never touch sign-ups; deletes drop only that item's sign-ups). Actions:<br>`{action:'addGame', name, timeLabel?, venue?, needsRef?, openPlay?}` → `{ok, id}` (id derived from name; `win_points` defaults to 10 via the column DEFAULT — set a custom value with a follow-up updateGame).<br>`{action:'updateGame', gameId, name?, timeLabel?, venue?, needsRef?, openPlay?, winPoints?, roundPoints?, teamSize?, players?, pointsLabel?, descr?, videoUrl?, headToHead?, isBracket?, bracketIntro?}` (`roundPoints` = migration 010 — points each within-tribe bracket-round win awards; the championship still awards `winPoints`) (`winPoints` = points the winning tribe earns when a ref logs a winner, migration 004; `players`/`pointsLabel` = the two pills on the game detail; `descr` = "How to play"; `videoUrl` = "See how it's played" link; `teamSize` = migration 011 — players per team (1 = individuals; ≥2 splits each slot into Team 1 / Team 2 … per tribe, players pick a teammate at sign-up, and refs score whole teams); `headToHead` = migration 009 flag driving ref scoring — ON → winner-picker awarding the flat `winPoints`, OFF → ref types **one score per player** (each person logged separately); `isBracket`/`bracketIntro` = migration 009 bracket flag + intro blurb. `headToHead`/`isBracket`/`bracketIntro` are updated separately + defensively, so a save still works pre-009; empty string clears the text fields).<br>`{action:'removeGame', gameId}` (deletes its slots + sign-ups + ref assignment + bracket rounds).<br>`{action:'addSlot', gameId, startMin, label, capBuffalo, capRoadhouse, roundNo?, lane?}` → `{ok, id}` (`roundNo`/`lane` = migration 012 bracket-match placement, written defensively; `lane` ∈ `'buffalo'|'roadhouse'|'final'`).<br>`{action:'updateSlot', slotId, startMin?, label?, capBuffalo?, capRoadhouse?, roundNo?, lane?}` (slot id is stable, so sign-ups survive an edit; `roundNo:null`/`lane:null` clear the bracket placement).<br>`{action:'removeSlot', slotId}` (drops that slot's sign-ups).<br>**Bracket rounds** (migration 009, table `bo_bracket_rounds`): `{action:'addRound', gameId}` (appends a blank "New round"), `{action:'updateRound', roundId, timeLabel?, name?, detail?, team?}` (`team` = `'buffalo'|'roadhouse'|'both'|'final'` — drives the round's accent + 🏆 on the championship), `{action:'removeRound', roundId}`. Return `{ok:true}` (or `409 "Bracket rounds need migration 009"` pre-migration). Returns `{ok:true}`. `ac-overview.gamesCatalog[]` carries `slots[]` `{id,startMin,label,capBuffalo,capRoadhouse,nBuffalo,nRoadhouse,roundNo,lane,people[]}` (`people` = `{id,name,team}` per signed-up person — powers the slot roster chips; `roundNo`/`lane` = migration 012 bracket placement) plus `headToHead`, `isBracket`, `bracketIntro`, `teamSize`, and `bracketRounds[]` `{id,time,name,detail,team}` for the editors. |

**Note on real routes:** the admin functions live under the **`ac`** prefix (`/api/ac-overview`, `/api/ac/{action}`) because Azure Functions reserves `admin`. The `/api/admin/*` paths above are the logical contract names; the client calls the `ac` forms.

**Server caching (Fabric load):** the shared half of the bootstrap payload (games, slots, rosters, tribes, schedule, dip, relay, scores, announcements — 12 queries) is cached in-process for ~45s (`api/lib/cache.js`). Only the 2 per-user queries run every call. Mutations pass `{fresh:true}` or call `bustSharedBootstrap()` so the writer sees their change immediately and others pick it up on the next 60s poll.

## `GET /api/bootstrap` response shape

```json
{
  "user": { …user object… },
  "settings": { "eventMode": "signup", "scoresRevealed": false, "dipRevealed": false },
  "serverTime": "2026-08-14T15:04:05Z",
  // Game-detail content comes straight from bo_games: `players`/`pointsLabel` (the two
  // pills), `descr` ("How to play"), `videoUrl` ("See how it's played"), `inventory` (kept
  // in the payload but no longer shown on the detail). Migration 007 populates them from the
  // rules doc; empty string when not set.
  "games": [
    { "id":"cornhole", "name":"Cornhole", "venue":"Main Lawn", "openPlay":false, "needsRef":true,
      "runtimeLabel":"1:30 PM – 2:00 PM",
      "players":"4 teams of 2",                    // players pill
      "pointsLabel":"1 on the board, 3 in the hole — qualifying to 11, championship to 21",  // points pill
      "descr":"Players alternate throws; feet stay behind the board. …",   // "How to play"
      "inventory":"Cornhole boards and bags",      // no longer rendered on the detail
      "videoUrl":"https://youtu.be/…",             // "See how it's played" (or "")
      "headToHead":true,                           // migration 009 — drives ref scoring (undefined pre-009 → frontend derives from !openPlay)
      "isBracket":true,                            // migration 009 — 🏆 pill + bracket path (undefined pre-009 → frontend BRACKETS fallback)
      "bracket":{ "intro":"Cornhole is bracket play …",
                  "rounds":[ {"time":"1:30 – 2:00 PM","name":"Qualifiers","detail":"…","team":"both"},
                             {"time":"3:00 PM","name":"Championship","detail":"…","team":"final"} ] },  // null when not a bracket
      "teamSize":2,                                // migration 011 — 1 = individuals; ≥2 = team game
      "slots":[ {"id":1,"startMin":810,"label":"1:30 PM","capBuffalo":4,"capRoadhouse":4,
                 "buffalo":["Reggie H.","Cory Z."],"roadhouse":["Kate V.","Bo B."],
                 "teamSize":2,                     // per-slot copy of the game's team size
                 "buffaloTeams":[["Reggie H.","Cory Z."]], "roadhouseTeams":[["Kate V.","Bo B."]],  // null for individual games
                 "mine":false} ],
      "mySlotId":null, "mine":false }
  ],
  "blocks": [ {"id":"b130","label":"1:30 PM Rotation","time":"1:30 – 2:00 PM","slot":[810,840],"place":"Courts · Lawn · Cafe"}, … ],
  "mySignups": [ {"gameId":"corn","game":"Cornhole","slotLabel":"1:30 – 2:00 PM"} ],
  "schedule": [ {"id":1,"timeLabel":"8:00","ampm":"AM","endLabel":"9:00","endAmpm":"AM","title":"Check-In & Tribe Paint","place":"Main Lawn","kind":"done"} ],
  "tribes": {
    "buffalo":   [ {"name":"Marcus T.","role":"SUP Ref"}, {"name":"Dana W.","role":""} ],
    "roadhouse": [ … ]
  },
  "dip": {
    "counts": { "buffalo": 3, "roadhouse": 3 },
    "entries": [ {"id":4,"no":1,"team":"buffalo","name":"Dana W.","isMine":false} ],
    "myEntry": false, "myVote": null
  },
  "relay": {
    "legs": [ {"id":"rl1","name":"Tire Flip Sprint","cap":4,"desc":"…"} ],
    "roster": { "rl1": {"buffalo":["Cory Z."],"roadhouse":[]} },
    "myLeg": null
  },
  "idols": [ {"id":1,"title":"Clue 1","clue":"Where the herd refuels.","releaseMin":null,"found":false} ],
  "announcements": [ {"id":1,"title":"…","body":"…","createdAt":"…"} ],
  "myResults": [ {"game":"Penny Stacking","detail":"18 pennies, one hand","pts":5} ],
  "scores": { "revealed": false },       // same shape as GET /api/scores
  // Leaderboard — top 10 scorers per tribe (SUM of bo_results.pts grouped by
  // player_name+winner; pair entries rank as the pair) + the caller's own rank
  // within their tribe (competition ranking; null = no points yet). Visible all
  // game day — it shows individual points, NOT the sealed team totals.
  "leaderboard": { "buffalo": [ {"name":"Dana W.","pts":45} ], "roadhouse": [ {"name":"Kate V.","pts":50} ],
                   "myRank": 2, "myPts": 30, "tribeCount": 7 },

  // ── refs only (omitted for plain players) ──
  "refStations": [
    { "gameId":"corn", "name":"Cornhole", "venue":"The Lawn", "timeLabel":"1:30 – 2:00 PM",
      "type":"vs", "headToHead":true, "isBracket":true, "teamSize":2, "openPlay":false, "winPoints":20, "roundPoints":10,   // type: 'vs' (winner-picker) or 'walk' (score per PERSON) — driven by head_to_head (migration 009); roundPoints = per-bracket-round win (migration 010); teamSize (migration 011) → the ref taps whole teams
      "slots":[ {"id":11,"label":"1:30 PM","startMin":810,"buffalo":["Cory Z."],"roadhouse":["Maggie F."],
                 "teamSize":2,"buffaloTeams":[["Cory Z.","Dana W."]],"roadhouseTeams":[["Maggie F.","Kate V."]],
                 "roundNo":1,"lane":"buffalo"} ],   // migration 012 — bracket-match placement (null = not a bracket match)
      "signups":[ {"name":"Marcus T.","team":"buffalo","slot":"1:30 PM"} ] }
  ],
  "refGames": [                                               // every game + assignment status, for the ref Games tab
    { "gameId":"corn","name":"Cornhole","venue":"The Lawn","timeLabel":"…","openPlay":false,
      "needsRef":true,"refNames":["Will F.","Marcus T."],"mine":true,"slotCount":2 }
  ],
  "refResults": [                                             // every logged result (newest first) so refs see what's scored
    { "id":5,"game":"Cornhole","detail":"Buffalo won (+20)","winner":"buffalo","pts":20,
      "playerName":"Cory Z. & Dana W.","slotId":11,"slotLabel":"1:30 PM","roundLabel":null,
      "enteredBy":"Will F.","mine":true,"createdAt":"…" }
  ],
  "allPlayers": [ {"name":"Dana W.","team":"buffalo"} ]       // for walk-up search (refs only)
}
```

`refStations` = games **assigned to the calling ref** in `bo_ref_assignments` (walk-up games included —
they're assigned like anything else, no longer auto-shared to every ref). Multiple refs can hold the
same game (migration 010). Each station carries its `slots` (with per-tribe rosters) so the ref picks
which timeslot they're scoring. The ref UI groups the scoring by slot; results are still logged per
`POST /api/results` (tagged with `slotLabel`/`roundLabel` so slots and bracket rounds show a green
**Scored** mark, and re-scoring goes through `DELETE /api/results/{id}` first). `refGames` lists every
game with everyone reffing it (`refNames`) to power the ref self-assign tab.

Notes:
- `dip.entries[].name` is included **only** for entries on the viewer's own team (cooks are anonymous
  to the other tribe / voters). `no` is the stable dip number (order of entry).
- `tribes` rosters are built from `bo_users` with a team, name-formatted; role is `'SUP Ref'` if ref, else `''`
  with a team, `'SUP Ref'` if ref with a team, else `''`.
- `blocks` are constants (defined in `api/lib/blocks.js`), mirrored in the seed data:
  `b130 [810,840]`, `b200 [840,870]`, `b230 [870,900]`, `b300 [900,930]`, `open` (no slot).
- `myResults` = rows in `bo_results` where `player_name` equals the caller's display name, plus
  vs-results are NOT personal. pts shown per row.

## `GET /api/admin/overview` response shape

```json
{
  "stats": { "people": 20, "games": 26, "refs": 2, "admins": 2 },
  "people": [ { "id":1, "name":"Cory Z.", "team":"buffalo", "isAdmin":true, "isRef":false,
                "shirtSize":"M", "years":"1st", "songRequest":"Artist — Title",
                "games":[{"gameId":"corn","name":"Cornhole"}] } ],
  "gamesCatalog": [ { "id":"corn", "name":"Cornhole", "block":"b130", "blockLabel":"1:30 PM Rotation",
                      "players":"2 per tribe", "pointsLabel":"…", "needsRef":true, "venue":"The Lawn" } ],
  "schedule": [ …same as bootstrap, includes id… ],
  "dip": { "entries":[ {"id":4,"no":1,"name":"Dana W.","team":"buffalo","votes":6} ],
           "counts":{"buffalo":3,"roadhouse":3}, "totalVotes":27, "revealed":false },
  "relay": { "legs":[…], "roster":{…}, "total": 9 },
  "scores": { "buffalo":245, "roadhouse":228, "revealed":false },
  "results": [ { "id":5, "game":"Back to Back Stand", "detail":"9 stands in 60 sec", "pts":10,
                 "winner":"buffalo", "enteredBy":"Will F.", "editedBy":"Cory Z.", "createdAt":"…",
                 "history":[ {"pts":8,"by":"Will F.","when":"…"} ] } ],
  "refAssignments": { "pickle": [7, 9] },     // gameId -> [userId, …] (multi-ref, migration 010)
  "refs": [ {"id":7,"name":"Marcus T."} ],    // users with is_ref=1
  "settings": { "eventMode":"signup", "refJoinCode":"txrhbuff2026", "scoresRevealed":false, "dipRevealed":false },
  "announcements": [ … ]
}
```

## Database (all tables prefixed `bo_`, created by `infra/migrations/001_init.sql`)

```
bo_users            id INT IDENTITY PK, email NVARCHAR(255) NULL UNIQUE(filtered), username NVARCHAR(100) NULL UNIQUE(filtered),
                    password_hash NVARCHAR(500), first_name NVARCHAR(100), last_name NVARCHAR(100),
                    team NVARCHAR(20) NULL, shirt_size NVARCHAR(10), years NVARCHAR(30), song_request NVARCHAR(300),
                    is_ref BIT DEFAULT 0, is_admin BIT DEFAULT 0, created_at DATETIME2 DEFAULT SYSUTCDATETIME()
bo_settings         [key] NVARCHAR(50) PK, [value] NVARCHAR(400)
bo_games            id NVARCHAR(20) PK, name NVARCHAR(100), block NVARCHAR(10), cap INT, players NVARCHAR(50),
                    time_label NVARCHAR(50), points_label NVARCHAR(50), needs_ref BIT, venue NVARCHAR(80),
                    descr NVARCHAR(MAX), inventory NVARCHAR(300), video_url NVARCHAR(400) NULL, open_play BIT, sort INT,
                    win_points INT [004], round_points INT [010], head_to_head/is_bracket/bracket_intro [009], team_size INT [011]
bo_signups          user_id INT, slot_id INT, team_no INT NULL — PK (user_id, slot_id). team_no (migration 011) = which team within (slot, tribe) for team games; NULL for individual games.
bo_dip_entries      id INT IDENTITY PK, user_id INT UNIQUE, team NVARCHAR(20), created_at
bo_dip_votes        user_id INT PK, dip_entry_id INT
bo_relay_legs       id NVARCHAR(10) PK, name NVARCHAR(100), cap INT, descr NVARCHAR(300), sort INT
bo_relay_signups    user_id INT PK, leg_id NVARCHAR(10)
bo_results          id INT IDENTITY PK, game_name NVARCHAR(100), detail NVARCHAR(300), winner NVARCHAR(20),
                    pts INT, pts_buffalo INT DEFAULT 0, pts_roadhouse INT DEFAULT 0, player_name NVARCHAR(100) NULL,
                    entered_by NVARCHAR(100), entered_by_id INT, edited_by NVARCHAR(100) NULL,
                    created_at DATETIME2, updated_at DATETIME2 NULL
bo_result_history   id INT IDENTITY PK, result_id INT, pts INT, by_name NVARCHAR(100), created_at DATETIME2
bo_announcements    id INT IDENTITY PK, title NVARCHAR(200), body NVARCHAR(MAX), created_at DATETIME2
bo_ref_assignments  game_id NVARCHAR(20), user_id INT — PK (game_id, user_id) since migration 010 (was game_id-only)
bo_schedule         id INT IDENTITY PK, time_label NVARCHAR(20), ampm NVARCHAR(5), title NVARCHAR(150),
                    place NVARCHAR(120), kind NVARCHAR(10) DEFAULT 'up', sort INT
```

Team scores = `SUM(pts_buffalo)` / `SUM(pts_roadhouse)` over `bo_results`.

Seed data (in the migration, idempotent `IF NOT EXISTS` / `MERGE`):
- `bo_settings`: `event_mode='signup'`, `ref_join_code='txrhbuff2026'`, `scores_revealed='0'`, `dip_revealed='0'`.
- `bo_games`: the 26 games from the design mockup (ids: corn, pong, pickle, island, wipeout, roller, skee,
  ring, horse, golf, b2b, puzzle, nerf, spiral, wheels, mug, beer, archery, chimney, charades, box, song,
  memory, penny, hook, suck, state, tpuzzle — note: penny/hook/suck/state/tpuzzle are `open_play=1, cap=0`).
  Copy names/caps/players/time/points/ref/venue/desc/inventory verbatim from the mockup's `GAMES` array.
- `bo_relay_legs`: rl1–rl6 from the mockup.
- `bo_schedule`: the 10 rows from the mockup's `baseSchedule()`.

## App settings (SWA → Environment variables)

| Setting | Purpose |
|---|---|
| `FABRIC_SQL_SERVER` | `…database.fabric.microsoft.com` host |
| `FABRIC_SQL_DATABASE` | database name |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | service principal for mssql AAD auth |
| `SESSION_SECRET` | long random string for token HMAC |
| `ADMIN_EMAILS` | comma-separated bootstrap admin emails |

## Function registration gotchas (from Herd-Intranet)

- `api/package.json` must have `"main": "index.js"`; `api/index.js` explicitly `require()`s each function module.
- **One `app.http()` call per file.**
- Keep dependencies minimal (`mssql` only) — SWA has a ~15,000-file deploy cap.
