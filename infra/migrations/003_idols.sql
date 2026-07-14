-- ============================================================================
-- Buff Olympics — 003_idols.sql
-- Admin-managed hidden-immunity idol clues.
-- Idempotent — safe to re-run. Run in the Fabric portal SQL query editor.
-- NO `USE`, NO `GO`, NO TRUNCATE — Fabric SQL DB doesn't support them.
-- ============================================================================

IF OBJECT_ID('dbo.bo_idols', 'U') IS NULL
CREATE TABLE dbo.bo_idols (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  title        NVARCHAR(200) NULL,   -- short public label (e.g. "Clue 1")
  clue         NVARCHAR(800) NULL,   -- the riddle text (hidden until released)
  release_min  INT           NULL,   -- minutes since midnight it unlocks; NULL = stays hidden
  found        BIT NOT NULL DEFAULT 0,
  sort         INT NOT NULL DEFAULT 0
);

-- Seed a starter set — all HIDDEN by default (found = 0, no release time).
-- The admin edits/adds/removes these and sets release times from the Admin Center.
IF NOT EXISTS (SELECT 1 FROM dbo.bo_idols)
INSERT INTO dbo.bo_idols (title, clue, release_min, found, sort) VALUES
  (N'Clue 1', N'Where the herd refuels.',            NULL, 0, 1),
  (N'Clue 2', N'Beneath the bleachers.',             NULL, 0, 2),
  (N'Clue 3', N'Where deliveries arrive.',           NULL, 0, 3),
  (N'Clue 4', N'The quietest corner of the Cafe.',   NULL, 0, 4),
  (N'Clue 5', N'Higher than everyone looks.',        NULL, 0, 5);
