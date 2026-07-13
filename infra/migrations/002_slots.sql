-- ============================================================================
-- Buff Olympics — 002_slots.sql
-- Slot-based sign-ups: each game has multiple 5-minute time slots, each with a
-- per-team headcount. Generated from Games_Lay_Out.xlsx. Idempotent.
-- Run in the Fabric portal SQL editor. NO USE / GO / TRUNCATE.
-- NOTE: this reseeds games/slots and RESETS sign-ups (safe pre-event).
-- ============================================================================

-- new columns on bo_games (idempotent)
IF COL_LENGTH('dbo.bo_games','open_play') IS NULL ALTER TABLE dbo.bo_games ADD open_play BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('dbo.bo_games','runtime_label') IS NULL ALTER TABLE dbo.bo_games ADD runtime_label NVARCHAR(60) NULL;

-- slots table
IF OBJECT_ID('dbo.bo_game_slots','U') IS NULL
CREATE TABLE dbo.bo_game_slots (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  game_id       NVARCHAR(20) NOT NULL,
  start_min     INT NOT NULL,           -- minutes since midnight (24h; 1:30 PM = 810)
  label         NVARCHAR(20) NOT NULL,  -- '1:30 PM'
  cap_buffalo   INT NOT NULL DEFAULT 0,
  cap_roadhouse INT NOT NULL DEFAULT 0,
  sort          INT NOT NULL DEFAULT 0
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_bo_game_slots_game')
CREATE INDEX ix_bo_game_slots_game ON dbo.bo_game_slots(game_id);

-- sign-ups become slot-based (drop old game-level table + data, recreate)
IF OBJECT_ID('dbo.bo_signups','U') IS NOT NULL DROP TABLE dbo.bo_signups;
CREATE TABLE dbo.bo_signups (
  user_id    INT NOT NULL,
  slot_id    INT NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_bo_signups PRIMARY KEY (user_id, slot_id)
);

-- ── reseed games + slots ──
DELETE FROM dbo.bo_game_slots;
DELETE FROM dbo.bo_games;

INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('cornhole', N'Cornhole', NULL, 0, NULL, N'1:30 PM – 2:00 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 1, N'1:30 PM – 2:00 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('island-flip', N'Island Flip', NULL, 0, NULL, N'1:30 PM – 1:55 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 2, N'1:30 PM – 1:55 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('sharpshooter', N'Sharpshooter', NULL, 0, NULL, N'2:00 PM – 2:20 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 3, N'2:00 PM – 2:20 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('beer-pong', N'Beer Pong', NULL, 0, NULL, N'2:30 PM – 3:30 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 4, N'2:30 PM – 3:30 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('inflatable-wipeout', N'Inflatable Wipeout', NULL, 0, NULL, N'1:30 PM – 2:10 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 5, N'1:30 PM – 2:10 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('big-wheels', N'Big Wheels', NULL, 0, NULL, N'2:20 PM – 2:45 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 6, N'2:20 PM – 2:45 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('outwit-memory', N'Outwit Memory', NULL, 0, NULL, N'3:00 PM – 3:45 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 7, N'3:00 PM – 3:45 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('sacred-passage', N'Sacred Passage', NULL, 0, NULL, N'1:30 PM – 2:30 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 8, N'1:30 PM – 2:30 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('charades-team-game', N'Charades Team Game', NULL, 0, NULL, N'2:40 PM – 3:30 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 9, N'2:40 PM – 3:30 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('inflatable-skee-ball', N'Inflatable Skee Ball', NULL, 0, NULL, N'1:30 PM – 2:15 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 10, N'1:30 PM – 2:15 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('inflatable-archery', N'Inflatable Archery', NULL, 0, NULL, N'2:30 PM – 3:40 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 11, N'2:30 PM – 3:40 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('ping-pong', N'Ping Pong', NULL, 0, NULL, N'1:30 PM – 2:30 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 12, N'1:30 PM – 2:30 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('unity-circle', N'Unity Circle', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 13, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('totem-tower', N'Totem Tower', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 14, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('hook-ring', N'Hook & Ring', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 15, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('name-that-song', N'Name that Song', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 16, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('suck-it-up', N'Suck it up', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 17, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('state-of-affairs', N'state of affairs', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 18, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('pickleball', N'Pickleball', NULL, 0, NULL, N'1:30 PM – 3:30 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 19, N'1:30 PM – 3:30 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('horse-bb', N'HORSE BB', NULL, 0, NULL, N'1:30 PM – 2:00 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 20, N'1:30 PM – 2:00 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('cliffhanger', N'Cliffhanger', NULL, 0, NULL, N'2:30 PM – 3:40 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 21, N'2:30 PM – 3:40 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('golf-putt', N'Golf Putt', NULL, 0, NULL, N'1:30 PM – 3:40 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 22, N'1:30 PM – 3:40 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('alliance-lift', N'Alliance Lift', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 23, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('firekeepers-puzzle', N'Firekeepers Puzzle', NULL, 0, NULL, N'Walk up anytime', NULL, 0, NULL, NULL, NULL, NULL, 1, 24, N'Walk up anytime');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('grip-and-survive', N'Grip and Survive', NULL, 0, NULL, N'2:15 PM – 2:35 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 25, N'2:15 PM – 2:35 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('what-s-lurking', N'What''s Lurking?', NULL, 0, NULL, N'2:45 PM – 3:25 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 26, N'2:45 PM – 3:25 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('puzzle', N'Puzzle', NULL, 0, NULL, N'1:30 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 27, N'1:30 PM');
INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort, runtime_label) VALUES ('spiral-architect', N'Spiral Architect', NULL, 0, NULL, N'2:00 PM – 3:00 PM', NULL, 0, NULL, NULL, NULL, NULL, 0, 28, N'2:00 PM – 3:00 PM');

INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cornhole', 810, N'1:30 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cornhole', 840, N'2:00 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('island-flip', 810, N'1:30 PM', 5, 5, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('island-flip', 815, N'1:35 PM', 5, 5, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('island-flip', 820, N'1:40 PM', 5, 5, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('island-flip', 825, N'1:45 PM', 5, 5, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('island-flip', 830, N'1:50 PM', 5, 5, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('island-flip', 835, N'1:55 PM', 5, 5, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sharpshooter', 840, N'2:00 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sharpshooter', 850, N'2:10 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sharpshooter', 860, N'2:20 PM', 2, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('beer-pong', 870, N'2:30 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('beer-pong', 890, N'2:50 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('beer-pong', 910, N'3:10 PM', 2, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('beer-pong', 930, N'3:30 PM', 2, 2, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 810, N'1:30 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 815, N'1:35 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 820, N'1:40 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 825, N'1:45 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 830, N'1:50 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 835, N'1:55 PM', 1, 1, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 840, N'2:00 PM', 1, 1, 6);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 845, N'2:05 PM', 1, 1, 7);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-wipeout', 850, N'2:10 PM', 1, 1, 8);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('big-wheels', 860, N'2:20 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('big-wheels', 865, N'2:25 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('big-wheels', 870, N'2:30 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('big-wheels', 875, N'2:35 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('big-wheels', 880, N'2:40 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('big-wheels', 885, N'2:45 PM', 1, 1, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('outwit-memory', 900, N'3:00 PM', 5, 5, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('outwit-memory', 915, N'3:15 PM', 5, 5, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('outwit-memory', 930, N'3:30 PM', 5, 5, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('outwit-memory', 945, N'3:45 PM', 5, 5, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 810, N'1:30 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 815, N'1:35 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 820, N'1:40 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 825, N'1:45 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 830, N'1:50 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 835, N'1:55 PM', 1, 1, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 840, N'2:00 PM', 1, 1, 6);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 845, N'2:05 PM', 1, 1, 7);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 850, N'2:10 PM', 1, 1, 8);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 855, N'2:15 PM', 1, 1, 9);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 860, N'2:20 PM', 1, 1, 10);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 865, N'2:25 PM', 1, 1, 11);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('sacred-passage', 870, N'2:30 PM', 1, 1, 12);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('charades-team-game', 880, N'2:40 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('charades-team-game', 890, N'2:50 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('charades-team-game', 900, N'3:00 PM', 2, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('charades-team-game', 910, N'3:10 PM', 2, 2, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('charades-team-game', 920, N'3:20 PM', 2, 2, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('charades-team-game', 930, N'3:30 PM', 2, 2, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-skee-ball', 810, N'1:30 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-skee-ball', 825, N'1:45 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-skee-ball', 840, N'2:00 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-skee-ball', 855, N'2:15 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 870, N'2:30 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 880, N'2:40 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 890, N'2:50 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 900, N'3:00 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 910, N'3:10 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 920, N'3:20 PM', 1, 1, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 930, N'3:30 PM', 1, 1, 6);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('inflatable-archery', 940, N'3:40 PM', 1, 1, 7);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('ping-pong', 810, N'1:30 PM', 0, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('ping-pong', 830, N'1:50 PM', 2, 0, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('ping-pong', 850, N'2:10 PM', 0, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('ping-pong', 870, N'2:30 PM', 2, 0, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('pickleball', 810, N'1:30 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('pickleball', 840, N'2:00 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('pickleball', 870, N'2:30 PM', 2, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('pickleball', 900, N'3:00 PM', 2, 2, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('pickleball', 930, N'3:30 PM', 2, 2, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('horse-bb', 810, N'1:30 PM', 3, 3, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('horse-bb', 825, N'1:45 PM', 3, 3, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('horse-bb', 840, N'2:00 PM', 3, 3, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 870, N'2:30 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 880, N'2:40 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 890, N'2:50 PM', 2, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 900, N'3:00 PM', 2, 2, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 910, N'3:10 PM', 2, 2, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 920, N'3:20 PM', 2, 2, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 930, N'3:30 PM', 2, 2, 6);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('cliffhanger', 940, N'3:40 PM', 2, 2, 7);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 810, N'1:30 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 820, N'1:40 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 830, N'1:50 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 840, N'2:00 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 850, N'2:10 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 860, N'2:20 PM', 1, 1, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 870, N'2:30 PM', 1, 1, 6);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 880, N'2:40 PM', 1, 1, 7);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 890, N'2:50 PM', 1, 1, 8);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 900, N'3:00 PM', 1, 1, 9);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 910, N'3:10 PM', 1, 1, 10);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 920, N'3:20 PM', 1, 1, 11);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 930, N'3:30 PM', 1, 1, 12);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('golf-putt', 940, N'3:40 PM', 1, 1, 13);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('grip-and-survive', 855, N'2:15 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('grip-and-survive', 860, N'2:20 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('grip-and-survive', 865, N'2:25 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('grip-and-survive', 870, N'2:30 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('grip-and-survive', 875, N'2:35 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('what-s-lurking', 885, N'2:45 PM', 1, 1, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('what-s-lurking', 895, N'2:55 PM', 1, 1, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('what-s-lurking', 905, N'3:05 PM', 1, 1, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('what-s-lurking', 915, N'3:15 PM', 1, 1, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('what-s-lurking', 925, N'3:25 PM', 1, 1, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('puzzle', 810, N'1:30 PM', 3, 3, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 840, N'2:00 PM', 2, 2, 0);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 850, N'2:10 PM', 2, 2, 1);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 860, N'2:20 PM', 2, 2, 2);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 870, N'2:30 PM', 2, 2, 3);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 880, N'2:40 PM', 2, 2, 4);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 890, N'2:50 PM', 2, 2, 5);
INSERT INTO dbo.bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort) VALUES ('spiral-architect', 900, N'3:00 PM', 2, 2, 6);

-- ── reseed relay legs (closing relay: 6 legs + Final Build Challenge) ──
IF OBJECT_ID('dbo.bo_relay_signups','U') IS NOT NULL DELETE FROM dbo.bo_relay_signups;
DELETE FROM dbo.bo_relay_legs;
INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort) VALUES
 ('rl1', N'Relay Leg 1', 4, N'Closing game relay leg.', 1),
 ('rl2', N'Relay Leg 2', 4, N'Closing game relay leg.', 2),
 ('rl3', N'Relay Leg 3', 4, N'Closing game relay leg.', 3),
 ('rl4', N'Relay Leg 4', 4, N'Closing game relay leg.', 4),
 ('rl5', N'Relay Leg 5', 4, N'Closing game relay leg.', 5),
 ('rl6', N'Relay Leg 6', 4, N'Closing game relay leg.', 6),
 ('rlfinal', N'Final Build Challenge', 6, N'The closing build challenge to bring it home.', 7);
