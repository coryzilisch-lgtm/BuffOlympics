-- 014_dip_numbers.sql — assignable Dip Off numbers.
--
-- The number on each dip ("Dip #3") used to be DERIVED from creation order, so
-- it silently renumbered every other dip whenever a cook was added or removed —
-- and the physical cards on the table would stop matching the ballot. This
-- stores the number so an admin can assign it to match the table.
--
-- RUN IN TWO STEPS (Fabric parses a batch up front, so a batch that ALTERs a
-- table AND references the new column fails with Msg 207):
--   Part 1 — the ALTER
--   Part 2 — the backfill
-- Idempotent: re-running either part is a no-op.
--
-- The backend reads dip_no defensively, so the app works before this runs —
-- numbers just stay derived from creation order until it does.

-- ─────────────────────────── PART 1 — schema ───────────────────────────
-- Run this alone, then run Part 2 in a second execution.

IF COL_LENGTH('dbo.bo_dip_entries', 'dip_no') IS NULL
  ALTER TABLE dbo.bo_dip_entries ADD dip_no INT NULL;

-- ─────────────────────────── PART 2 — backfill ──────────────────────────
-- Run this after Part 1 has completed. Numbers the existing dips 1..N in the
-- order they were entered — exactly what the app displayed before — so nobody's
-- number changes on the day this ships. Only touches rows with no number yet.

;WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM dbo.bo_dip_entries
)
UPDATE d
   SET d.dip_no = n.rn
  FROM dbo.bo_dip_entries d
  JOIN numbered n ON n.id = d.id
 WHERE d.dip_no IS NULL;
