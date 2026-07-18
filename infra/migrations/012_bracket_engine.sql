-- 012_bracket_engine.sql — real bracket progression + per-slot result identity.
--
-- Run BY HAND in the Fabric portal SQL editor, IN TWO STEPS (same Msg 207 gotcha
-- as 009/010/011). Run Part 1, wait for success, then run Part 2. Idempotent.
--
-- What it enables (backend reads defensively — pre-012 everything behaves as
-- today):
--   * bo_game_slots.round_no / lane: a bracket game's slots become MATCHES in a
--     structured bracket. round_no groups them into rounds; lane says whose
--     match it is ('buffalo' | 'roadhouse' = within-tribe, 'final' = the
--     cross-tribe championship). Round-1 matches seed from sign-ups; later
--     rounds show "waiting on previous round" until the feeding matches are
--     scored, then auto-populate with the winners. Admin builds the structure
--     in the Bracket Builder (Admin → Games → 🏆 Bracket).
--   * bo_results.slot_id: results are tagged with the slot's ID, not just its
--     time label — so two matches at the same time (BCI-vs-BCI at 1:30 AND
--     TXRH-vs-TXRH at 1:30) get scored independently. Fixes "scoring one 1:30
--     game marked both complete."

-- ═════════════════════════ PART 1 — schema ═════════════════════════

IF COL_LENGTH('dbo.bo_game_slots', 'round_no') IS NULL
  ALTER TABLE dbo.bo_game_slots ADD round_no INT NULL;

IF COL_LENGTH('dbo.bo_game_slots', 'lane') IS NULL
  ALTER TABLE dbo.bo_game_slots ADD lane NVARCHAR(20) NULL;

IF COL_LENGTH('dbo.bo_results', 'slot_id') IS NULL
  ALTER TABLE dbo.bo_results ADD slot_id INT NULL;

-- ═════════════════════ PART 2 — backfill (run AFTER Part 1) ═════════════════════
-- Uncomment and run as a separate execution. Marks each bracket game's existing
-- SIGN-UP slots as Round 1 matches, deriving the lane from the caps (a slot open
-- to only one tribe is that tribe's match). Slots open to both tribes stay
-- lane-NULL (legacy dual slots — still scoreable; assign lanes in the Bracket
-- Builder if you split them). Then add the later-round + championship matches in
-- the Bracket Builder.

-- UPDATE s SET s.round_no = 1, s.lane = 'buffalo'
--   FROM dbo.bo_game_slots s JOIN dbo.bo_games g ON g.id = s.game_id
--   WHERE g.is_bracket = 1 AND s.round_no IS NULL AND s.cap_buffalo > 0 AND s.cap_roadhouse = 0;
-- UPDATE s SET s.round_no = 1, s.lane = 'roadhouse'
--   FROM dbo.bo_game_slots s JOIN dbo.bo_games g ON g.id = s.game_id
--   WHERE g.is_bracket = 1 AND s.round_no IS NULL AND s.cap_buffalo = 0 AND s.cap_roadhouse > 0;
-- UPDATE s SET s.round_no = 1
--   FROM dbo.bo_game_slots s JOIN dbo.bo_games g ON g.id = s.game_id
--   WHERE g.is_bracket = 1 AND s.round_no IS NULL AND (s.cap_buffalo > 0 OR s.cap_roadhouse > 0);
