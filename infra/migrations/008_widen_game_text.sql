-- ============================================================================
-- Buff Olympics — 008_widen_game_text.sql
-- 007_game_details.sql truncated on 8 games: bo_games.points_label /
-- bo_games.players were sized NVARCHAR(50) (001_init.sql) and several of the
-- rules-doc point summaries run longer than that. Widen both columns, then
-- re-apply the UPDATEs that 007 rolled back for those 8 games (SQL Server
-- terminates only the failing statement, not the whole batch, so the other
-- 18 games from 007 already landed — these re-applies are idempotent).
-- Run in the Fabric portal SQL query editor. NO `USE`/`GO`/TRUNCATE.
-- ============================================================================

IF COL_LENGTH('dbo.bo_games', 'points_label') IS NOT NULL
  ALTER TABLE dbo.bo_games ALTER COLUMN points_label NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.bo_games', 'players') IS NOT NULL
  ALTER TABLE dbo.bo_games ALTER COLUMN players NVARCHAR(200) NULL;

UPDATE dbo.bo_games SET
  points_label = N'5 points to the team with the most hoops on their teammate'
WHERE id = 'unity-circle';

UPDATE dbo.bo_games SET
  points_label = N'1 point per 2 pennies stacked (10 pennies = 5 pts, 20 = 10 pts, 30 = 15 pts)'
WHERE id = 'totem-tower';

UPDATE dbo.bo_games SET
  points_label = N'1 point per correct song guess — 10 points if successful'
WHERE id = 'name-that-song';

UPDATE dbo.bo_games SET
  points_label = N'15 points to the player who completes the most of the puzzle'
WHERE id = 'firekeepers-puzzle';

UPDATE dbo.bo_games SET
  points_label = N'1 point on the board, 3 in the hole — qualifying to 11, championship to 21 (tiebreak to 25)'
WHERE id = 'cornhole';

UPDATE dbo.bo_games SET
  points_label = N'Ball 1 = 5 pts, ball 2 = 10 pts, ball 3 = 15 pts, all the way through = 25 pts'
WHERE id = 'inflatable-wipeout';

UPDATE dbo.bo_games SET
  points_label = N'15 points to the team of the player with the fewest letters'
WHERE id = 'horse-bb';

UPDATE dbo.bo_games SET
  points_label = N'Max 25 points — 5 points per correct guess (5 objects)'
WHERE id = 'what-s-lurking';
