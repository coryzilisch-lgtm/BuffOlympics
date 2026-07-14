-- ============================================================================
-- Buff Olympics — 005_default_ref.sql
-- Referees are the default: mark every existing game as needing a ref in one
-- shot (saves checking the box on each game). After running this, just uncheck
-- the few games that DON'T need a ref in Admin Center → Games.
-- One-time bulk set — re-running re-checks every game, so run it once.
-- Run in the Fabric portal SQL query editor. NO `USE`/`GO`/TRUNCATE.
-- ============================================================================

UPDATE dbo.bo_games SET needs_ref = 1;
