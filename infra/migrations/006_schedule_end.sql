-- ============================================================================
-- Buff Olympics — 006_schedule_end.sql
-- Optional end time for schedule blocks (start/end range). Stored like the
-- start: a label ("9:00") + am/pm ("AM"). NULL = no end time (single moment).
-- Idempotent — safe to re-run. Run in the Fabric portal SQL query editor.
-- NO `USE`, NO `GO`, NO TRUNCATE — Fabric SQL DB doesn't support them.
-- ============================================================================

IF COL_LENGTH('dbo.bo_schedule', 'end_label') IS NULL
  ALTER TABLE dbo.bo_schedule ADD end_label NVARCHAR(20) NULL;

IF COL_LENGTH('dbo.bo_schedule', 'end_ampm') IS NULL
  ALTER TABLE dbo.bo_schedule ADD end_ampm NVARCHAR(4) NULL;
