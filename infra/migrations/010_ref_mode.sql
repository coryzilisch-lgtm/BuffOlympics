-- 010_ref_mode.sql — multi-ref assignments + scored-result tagging + bracket
-- round points + idol finder awards.
--
-- Run BY HAND in the Fabric portal SQL editor, IN TWO STEPS (same Msg 207
-- gotcha as 009: a batch that ALTERs a table and references the new column is
-- rejected at parse time). Run Part 1, wait for success, then run Part 2.
-- Idempotent — safe to re-run either part.
--
-- What it enables (all backend reads/writes are defensive, so the app runs
-- fine before this migration — the features just stay dormant):
--   * bo_ref_assignments PK (game_id) -> (game_id, user_id): ANY number of
--     refs can add the same game to their list; claiming never bumps another.
--   * bo_results.slot_label / round_label: results are tagged to the timeslot
--     / bracket round they scored, so the ref UI can show a green "Scored"
--     mark and let refs re-open + change a result.
--   * bo_games.round_points: points a within-tribe bracket-round WIN awards
--     (the championship still awards win_points). NULL/0 = advancement only.
--   * bo_idols.points / found_by: each idol clue is worth points to whoever
--     finds it; the admin awards them by picking the finder.

-- ═════════════════════════ PART 1 — schema ═════════════════════════

-- Multi-ref: swap the single-column PK for (game_id, user_id).
IF NOT EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.bo_ref_assignments')
    AND type = 'PK' AND name = 'PK_bo_ref_assignments_multi'
)
BEGIN
  DECLARE @pk sysname = (
    SELECT name FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.bo_ref_assignments') AND type = 'PK');
  IF @pk IS NOT NULL
    EXEC('ALTER TABLE dbo.bo_ref_assignments DROP CONSTRAINT [' + @pk + ']');
  ALTER TABLE dbo.bo_ref_assignments
    ADD CONSTRAINT PK_bo_ref_assignments_multi PRIMARY KEY (game_id, user_id);
END;

IF COL_LENGTH('dbo.bo_results', 'slot_label') IS NULL
  ALTER TABLE dbo.bo_results ADD slot_label NVARCHAR(80) NULL;
IF COL_LENGTH('dbo.bo_results', 'round_label') IS NULL
  ALTER TABLE dbo.bo_results ADD round_label NVARCHAR(120) NULL;

IF COL_LENGTH('dbo.bo_games', 'round_points') IS NULL
  ALTER TABLE dbo.bo_games ADD round_points INT NULL;

IF COL_LENGTH('dbo.bo_idols', 'points') IS NULL
  ALTER TABLE dbo.bo_idols ADD points INT NULL;
IF COL_LENGTH('dbo.bo_idols', 'found_by') IS NULL
  ALTER TABLE dbo.bo_idols ADD found_by NVARCHAR(120) NULL;

-- ═════════════════════ PART 2 — backfill (run AFTER Part 1) ═════════════════════
-- Uncomment and run as a separate execution:

-- -- Bracket games start at 10 points per round win (admin-editable per game).
-- UPDATE dbo.bo_games SET round_points = 10 WHERE is_bracket = 1 AND round_points IS NULL;
--
-- -- Idol clues start at 10 points each (admin-editable per clue).
-- UPDATE dbo.bo_idols SET points = 10 WHERE points IS NULL;
