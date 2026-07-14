-- ============================================================================
-- Buff Olympics — 004_win_points.sql
-- Per-game point value awarded to the winning tribe when a ref logs a
-- head-to-head / championship winner. Admin-editable in the Games editor.
-- Idempotent — safe to re-run. Run in the Fabric portal SQL query editor.
-- NO `USE`, NO `GO`, NO TRUNCATE — Fabric SQL DB doesn't support them.
-- ============================================================================

IF COL_LENGTH('dbo.bo_games', 'win_points') IS NULL
  ALTER TABLE dbo.bo_games ADD win_points INT NOT NULL CONSTRAINT DF_bo_games_win_points DEFAULT 10;
