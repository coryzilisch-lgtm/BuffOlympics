-- 011_team_games.sql — team games: a per-game team size + which team a player
-- signed up with, so a timeslot can hold Team 1 / Team 2 per tribe (players pick
-- their teammate) and a ref can score each team/matchup separately.
--
-- Run BY HAND in the Fabric portal SQL editor, IN TWO STEPS (same Msg 207 gotcha
-- as 009/010: a batch that ALTERs a table and then references the new column is
-- rejected at parse time). Run Part 1, wait for success, then run Part 2.
-- Idempotent — safe to re-run either part.
--
-- What it enables (all backend reads/writes are defensive, so the app runs fine
-- before this migration — the feature just stays dormant, every game behaves as
-- an individual game exactly like today):
--   * bo_games.team_size: players per team. NULL/1 = individuals (today's
--     behavior). 2 = pairs (Cornhole / Ping Pong), etc. A slot's per-tribe cap
--     divided by team_size = how many teams that tribe fields in the slot.
--   * bo_signups.team_no: which team group (1, 2, …) within a (slot, tribe) the
--     player joined — this is how partners are chosen at sign-up. NULL for
--     individual games.

-- ═════════════════════════ PART 1 — schema ═════════════════════════

IF COL_LENGTH('dbo.bo_games', 'team_size') IS NULL
  ALTER TABLE dbo.bo_games ADD team_size INT NULL;

IF COL_LENGTH('dbo.bo_signups', 'team_no') IS NULL
  ALTER TABLE dbo.bo_signups ADD team_no INT NULL;

-- ═════════════════════ PART 2 — backfill (run AFTER Part 1) ═════════════════════
-- Uncomment and run as a separate execution. Cornhole and Ping Pong are the
-- seeded bracket games (migration 009) and are played in pairs. Admin-editable
-- per game afterward (Games editor → "Team size").

-- UPDATE dbo.bo_games SET team_size = 2 WHERE id IN ('cornhole', 'ping-pong') AND team_size IS NULL;
