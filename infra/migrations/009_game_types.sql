-- ============================================================================
-- Buff Olympics — 009_game_types.sql
-- Two game-type features, both admin-editable in the Games editor:
--   1) head_to_head : does a ref score this game by picking a WINNING TRIBE
--      (flat win_points) or by TYPING points per player (variable)? Decoupled
--      from open_play (which is only about walk-up scheduling now). Backfilled
--      so nothing changes: games that USED to get the winner-picker (the
--      non-walk-up ones) start head_to_head = 1; walk-up games start 0.
--   2) is_bracket + bracket_intro + bo_bracket_rounds : bracket games and their
--      rounds, now stored in the DB and editable in the Admin Center (was a
--      hard-coded frontend config). Seeds the two existing brackets so nothing
--      is lost.
--
-- Idempotent — safe to re-run. Run in the Fabric portal SQL query editor.
-- NO `USE`, NO `GO`, NO TRUNCATE — Fabric SQL DB doesn't support them.
--
-- IMPORTANT — RUN IN TWO STEPS. Fabric parses a batch up front, so a statement
-- that references a column added earlier IN THE SAME BATCH fails (Msg 207).
-- Run PART 1 first, then run PART 2. (Splitting on the banner line is enough.)
-- ============================================================================

-- ─────────────────────────── PART 1 — schema ───────────────────────────────
-- Run this block FIRST, on its own.

IF COL_LENGTH('dbo.bo_games', 'head_to_head') IS NULL
  ALTER TABLE dbo.bo_games ADD head_to_head BIT NOT NULL CONSTRAINT DF_bo_games_h2h DEFAULT 1;

IF COL_LENGTH('dbo.bo_games', 'is_bracket') IS NULL
  ALTER TABLE dbo.bo_games ADD is_bracket BIT NOT NULL CONSTRAINT DF_bo_games_isbr DEFAULT 0;

IF COL_LENGTH('dbo.bo_games', 'bracket_intro') IS NULL
  ALTER TABLE dbo.bo_games ADD bracket_intro NVARCHAR(500) NULL;

IF OBJECT_ID('dbo.bo_bracket_rounds', 'U') IS NULL
  CREATE TABLE dbo.bo_bracket_rounds (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    game_id    NVARCHAR(60) NOT NULL,
    sort       INT NOT NULL CONSTRAINT DF_bo_bracket_rounds_sort DEFAULT 0,
    time_label NVARCHAR(100) NULL,
    name       NVARCHAR(100) NULL,
    detail     NVARCHAR(300) NULL,
    team       NVARCHAR(20)  NULL      -- 'buffalo' | 'roadhouse' | 'both' | 'final'
  );

-- ─────────────────────────── PART 2 — backfill + seed ──────────────────────
-- Run this block SECOND, AFTER Part 1 has committed.

-- Preserve pre-migration ref behavior: the winner-picker used to show for every
-- non-walk-up game, so those become head_to_head = 1; walk-up games become 0.
UPDATE dbo.bo_games SET head_to_head = CASE WHEN open_play = 1 THEN 0 ELSE 1 END;

-- Seed the two existing brackets (only if they aren't already seeded).
UPDATE dbo.bo_games
  SET is_bracket = 1,
      bracket_intro = N'Cornhole is bracket play — you keep facing your own tribe until the title game. If you win, here''s where you head next:'
  WHERE id = 'cornhole';

UPDATE dbo.bo_games
  SET is_bracket = 1,
      bracket_intro = N'Ping Pong is bracket play — each tribe runs its own bracket, then the two winners meet for the title:'
  WHERE id = 'ping-pong';

IF NOT EXISTS (SELECT 1 FROM dbo.bo_bracket_rounds WHERE game_id = 'cornhole')
  INSERT INTO dbo.bo_bracket_rounds (game_id, sort, time_label, name, detail, team) VALUES
    ('cornhole', 0, N'1:30 – 2:00 PM', N'Qualifiers',    N'Buffalo vs Buffalo · Texas Roadhouse vs Texas Roadhouse', 'both'),
    ('cornhole', 1, N'2:30 PM',        N'Semifinals',    N'Still within your own tribe',                             'both'),
    ('cornhole', 2, N'3:00 PM',        N'Championship',  N'Buffalo winner vs Texas Roadhouse winner',                'final');

IF NOT EXISTS (SELECT 1 FROM dbo.bo_bracket_rounds WHERE game_id = 'ping-pong')
  INSERT INTO dbo.bo_bracket_rounds (game_id, sort, time_label, name, detail, team) VALUES
    ('ping-pong', 0, N'1:30 – 2:30 PM', N'Qualifiers',                 N'Buffalo vs Buffalo · Texas Roadhouse vs Texas Roadhouse', 'both'),
    ('ping-pong', 1, N'2:50 PM',        N'Texas Roadhouse Semifinals', N'Texas Roadhouse bracket',                                'roadhouse'),
    ('ping-pong', 2, N'3:10 PM',        N'Buffalo Semifinals',         N'Buffalo bracket',                                        'buffalo'),
    ('ping-pong', 3, N'3:30 PM',        N'Championship',               N'Buffalo winner vs Texas Roadhouse winner',               'final');
