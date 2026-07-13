-- ============================================================================
-- Buff Olympics — 001_init.sql
-- Creates every bo_* table + seed data. Idempotent — safe to re-run.
-- Run in the Fabric portal SQL query editor (opened from the database item).
-- NO `USE`, NO `GO`, NO TRUNCATE — Fabric SQL DB doesn't support them.
-- ============================================================================

-- ── tables ──────────────────────────────────────────────────────────────────

IF OBJECT_ID('dbo.bo_users', 'U') IS NULL
CREATE TABLE dbo.bo_users (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  email         NVARCHAR(255) NULL,
  username      NVARCHAR(100) NULL,
  password_hash NVARCHAR(500) NOT NULL,
  first_name    NVARCHAR(100) NULL,
  last_name     NVARCHAR(100) NULL,
  team          NVARCHAR(20)  NULL,
  shirt_size    NVARCHAR(10)  NULL,
  years         NVARCHAR(30)  NULL,
  song_request  NVARCHAR(300) NULL,
  is_ref        BIT NOT NULL DEFAULT 0,
  is_admin      BIT NOT NULL DEFAULT 0,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Filtered unique indexes — email/username are nullable (refs have no email,
-- players have no username), so plain UNIQUE constraints won't do.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_bo_users_email' AND object_id = OBJECT_ID('dbo.bo_users'))
CREATE UNIQUE NONCLUSTERED INDEX ux_bo_users_email ON dbo.bo_users(email) WHERE email IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_bo_users_username' AND object_id = OBJECT_ID('dbo.bo_users'))
CREATE UNIQUE NONCLUSTERED INDEX ux_bo_users_username ON dbo.bo_users(username) WHERE username IS NOT NULL;

IF OBJECT_ID('dbo.bo_settings', 'U') IS NULL
CREATE TABLE dbo.bo_settings (
  [key]   NVARCHAR(50) PRIMARY KEY,
  [value] NVARCHAR(400) NULL
);

IF OBJECT_ID('dbo.bo_games', 'U') IS NULL
CREATE TABLE dbo.bo_games (
  id           NVARCHAR(20) PRIMARY KEY,
  name         NVARCHAR(100) NOT NULL,
  block        NVARCHAR(10)  NULL,
  cap          INT NOT NULL DEFAULT 0,
  players      NVARCHAR(50)  NULL,
  time_label   NVARCHAR(50)  NULL,
  points_label NVARCHAR(50)  NULL,
  needs_ref    BIT NOT NULL DEFAULT 0,
  venue        NVARCHAR(80)  NULL,
  descr        NVARCHAR(MAX) NULL,
  inventory    NVARCHAR(300) NULL,
  video_url    NVARCHAR(400) NULL,
  open_play    BIT NOT NULL DEFAULT 0,
  sort         INT NOT NULL DEFAULT 0
);

IF OBJECT_ID('dbo.bo_signups', 'U') IS NULL
CREATE TABLE dbo.bo_signups (
  user_id    INT NOT NULL,
  game_id    NVARCHAR(20) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_bo_signups PRIMARY KEY (user_id, game_id)
);

IF OBJECT_ID('dbo.bo_dip_entries', 'U') IS NULL
CREATE TABLE dbo.bo_dip_entries (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  user_id    INT NOT NULL UNIQUE,
  team       NVARCHAR(20) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.bo_dip_votes', 'U') IS NULL
CREATE TABLE dbo.bo_dip_votes (
  user_id      INT PRIMARY KEY,
  dip_entry_id INT NOT NULL
);

IF OBJECT_ID('dbo.bo_relay_legs', 'U') IS NULL
CREATE TABLE dbo.bo_relay_legs (
  id    NVARCHAR(10) PRIMARY KEY,
  name  NVARCHAR(100) NOT NULL,
  cap   INT NOT NULL DEFAULT 1,
  descr NVARCHAR(300) NULL,
  sort  INT NOT NULL DEFAULT 0
);

IF OBJECT_ID('dbo.bo_relay_signups', 'U') IS NULL
CREATE TABLE dbo.bo_relay_signups (
  user_id INT PRIMARY KEY,
  leg_id  NVARCHAR(10) NOT NULL
);

IF OBJECT_ID('dbo.bo_results', 'U') IS NULL
CREATE TABLE dbo.bo_results (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  game_name     NVARCHAR(100) NOT NULL,
  detail        NVARCHAR(300) NULL,
  winner        NVARCHAR(20)  NULL,
  pts           INT NOT NULL DEFAULT 0,
  pts_buffalo   INT NOT NULL DEFAULT 0,
  pts_roadhouse INT NOT NULL DEFAULT 0,
  player_name   NVARCHAR(100) NULL,
  entered_by    NVARCHAR(100) NULL,
  entered_by_id INT NULL,
  edited_by     NVARCHAR(100) NULL,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at    DATETIME2 NULL
);

IF OBJECT_ID('dbo.bo_result_history', 'U') IS NULL
CREATE TABLE dbo.bo_result_history (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  result_id  INT NOT NULL,
  pts        INT NOT NULL DEFAULT 0,
  by_name    NVARCHAR(100) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.bo_announcements', 'U') IS NULL
CREATE TABLE dbo.bo_announcements (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  title      NVARCHAR(200) NOT NULL,
  body       NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.bo_ref_assignments', 'U') IS NULL
CREATE TABLE dbo.bo_ref_assignments (
  game_id NVARCHAR(20) PRIMARY KEY,
  user_id INT NOT NULL
);

IF OBJECT_ID('dbo.bo_schedule', 'U') IS NULL
CREATE TABLE dbo.bo_schedule (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  time_label NVARCHAR(20)  NOT NULL,
  ampm       NVARCHAR(5)   NOT NULL,
  title      NVARCHAR(150) NOT NULL,
  place      NVARCHAR(120) NULL,
  kind       NVARCHAR(10)  NOT NULL DEFAULT 'up',
  sort       INT NOT NULL DEFAULT 0
);

-- ── seed: settings ──────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM dbo.bo_settings WHERE [key] = 'event_mode')
  INSERT INTO dbo.bo_settings ([key], [value]) VALUES ('event_mode', 'signup');
IF NOT EXISTS (SELECT 1 FROM dbo.bo_settings WHERE [key] = 'ref_join_code')
  INSERT INTO dbo.bo_settings ([key], [value]) VALUES ('ref_join_code', 'txrhbuff2026');
IF NOT EXISTS (SELECT 1 FROM dbo.bo_settings WHERE [key] = 'scores_revealed')
  INSERT INTO dbo.bo_settings ([key], [value]) VALUES ('scores_revealed', '0');
IF NOT EXISTS (SELECT 1 FROM dbo.bo_settings WHERE [key] = 'dip_revealed')
  INSERT INTO dbo.bo_settings ([key], [value]) VALUES ('dip_revealed', '0');

-- ── seed: games (26, verbatim from the design mockup GAMES array) ───────────
-- columns: (id, name, block, cap, players, time_label, points_label, needs_ref,
--           venue, descr, inventory, video_url, open_play, sort)

-- 1:30 PM Rotation
IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'corn')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('corn', N'Cornhole', 'b130', 2, N'2 per tribe', N'1:30 – 2:00 PM', N'Qual 11 / Final 21', 1, N'The Lawn', N'Teams alternate throws. Keep your feet behind the board. 1 point on the board, 3 in the hole. Bracket play runs through the afternoon — qualifiers to 11, championship to 21.', N'Cornhole boards & bags', NULL, 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'pong')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('pong', N'Ping Pong', 'b130', 2, N'2 per tribe', N'1:30 – 2:00 PM', N'First to 15', 1, N'In the Cafe', N'Let the ball bounce once on your side before returning. Service changes every 2 points (every point at deuce). 15 to win, win by 2. Bracket play through the afternoon.', N'Paddles, balls, table', NULL, 0, 2);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'pickle')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('pickle', N'Pickleball', 'b130', 2, N'2 per tribe', N'1:30 – 2:00 PM', N'First to 15', 1, N'The Courts', N'Rally scoring — every rally is a point. The serve and return must bounce once before being hit. First team to 15 with a 2-point lead wins. Bracket play through the afternoon.', N'Net, paddles, wiffleballs, chalk', NULL, 0, 3);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'island')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('island', N'Island Flip', 'b130', 5, N'5 per tribe', N'1:30 – 2:00 PM', N'TBD', 1, N'The Lawn', N'Flip your ''island'' (a bedsheet) completely over without anyone stepping off. If a foot touches the ground, start over. First tribe to flip wins.', N'2 bed sheets', NULL, 0, 4);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'wipeout')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('wipeout', N'Inflatable Wipeout', 'b130', 1, N'1 per tribe', N'1:30 – 2:00 PM', N'TBD', 1, N'Parking Lot', N'Survive the spinning arm on the big inflatable. Last one standing wins. A ref runs this station.', N'Inflatable Wipeout unit', NULL, 0, 5);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'roller')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('roller', N'Roller Ball Lever', 'b130', 1, N'1 per tribe', N'1:30 – 2:00 PM', N'TBD', 1, N'Parking Lot', N'Work the levers to guide the roller ball to the goal. Steady hands win.', N'Roller ball lever unit', NULL, 0, 6);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'skee')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('skee', N'Inflatable Skee Ball', 'b130', 1, N'1 per tribe', N'1:30 – 2:00 PM', N'TBD', 1, N'Parking Lot', N'Roll for the high-value pockets on the giant inflatable Skee Ball lane.', N'Inflatable Skee Ball unit', NULL, 0, 7);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'ring')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('ring', N'Ring Around the Teammate', 'b130', 2, N'2 per tribe', N'1:30 – 2:00 PM', N'5 pts', 0, N'Main Lawn', N'Using hula hoops, build a human ring toss. Players land as many rings on their partner as they can in one minute.', N'6–8 hula hoops', NULL, 0, 8);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'horse')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('horse', N'HORSE BB', 'b130', 3, N'3 per tribe', N'1:30 – 2:00 PM', N'Elimination', 1, N'The Hoop', N'The basketball trick-shot showdown. Make a shot the other tribe can''t match — miss a match and take a letter. First tribe to spell H-O-R-S-E is eliminated.', N'4–6 basketballs', NULL, 0, 9);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'golf')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('golf', N'Golf Putt', 'b130', 1, N'1 per tribe', N'1:30 – 2:00 PM', N'TBD', 1, N'The Patio', N'Sink the putt across the challenge green. The closest and most-made putts score for your tribe.', N'Putter, balls, cups', NULL, 0, 10);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'b2b')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('b2b', N'Back to Back Stand', 'b130', 2, N'2 per tribe', N'1:30 – 2:00 PM', N'10 pts', 0, N'Main Lawn', N'Partners sit back-to-back on the floor, link arms, and stand up together. The most stands in one minute wins.', N'Nothing needed', NULL, 0, 11);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'puzzle')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('puzzle', N'Puzzle', 'b130', 3, N'3 per tribe', N'1:30 – 2:00 PM', N'TBD', 0, N'The Cafe', N'Three teammates race the clock to complete the tribe puzzle before the other side finishes theirs.', N'2 matching puzzles', NULL, 0, 12);

-- 2:00 PM Rotation
IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'nerf')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('nerf', N'Nerf Gun Shooting', 'b200', 2, N'2 per tribe', N'2:00 – 2:30 PM', N'12 max', 1, N'The Range', N'Choose your Nerf gun. Knock down all the targets — 1 point per target. A ref runs the range.', N'Guns, bullets, shooting machine', NULL, 0, 13);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'spiral')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('spiral', N'Spiral Architect', 'b200', 2, N'2 per tribe', N'2:00 – 2:30 PM', N'TBD', 1, N'Parking Lot', N'Build the spiral and keep the ball rolling to the goal. Teamwork and steady hands win.', N'Spiral architect unit', NULL, 0, 14);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'wheels')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('wheels', N'Big Wheels', 'b200', 1, N'1 per tribe', N'2:00 – 2:30 PM', N'10 pts', 1, N'The Parking Lot', N'Race your Big Wheel down the parking lot. First rider across the finish line takes the points.', N'Big Wheels (or fix the tires!)', NULL, 0, 15);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'mug')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('mug', N'Mug Hold Challenge', 'b200', 1, N'1 per tribe', N'2:00 – 2:30 PM', N'TBD', 1, N'The Patio', N'Stand with arms fully extended, holding a water-filled mug in each hand. The longer you hold, the better your tribe''s time.', N'4 plastic mugs, timer', NULL, 0, 16);

-- 2:30 PM Rotation
IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'beer')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('beer', N'Beer Pong', 'b230', 2, N'2 per tribe', N'2:30 – 3:00 PM', N'10 pts', 0, N'Main Lawn', N'Land a ball in the other team''s cups; sink one and it''s removed. If both teammates hit, the balls roll back and you shoot again.', N'Balls & buckets (SUP provides)', NULL, 0, 17);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'archery')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('archery', N'Inflatable Archery', 'b230', 1, N'1 per tribe', N'2:30 – 3:00 PM', N'TBD', 1, N'Parking Lot', N'Take aim with the velcro arrows and stick the bullseye on the inflatable target.', N'Inflatable archery unit', NULL, 0, 18);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'chimney')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('chimney', N'Chimney Sweep', 'b230', 2, N'2 per tribe', N'2:30 – 3:00 PM', N'TBD', 1, N'Parking Lot', N'Climb and clear the chimney challenge with your teammate. A ref runs this station.', N'Chimney sweep unit', NULL, 0, 19);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'charades')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('charades', N'Charades', 'b230', 2, N'2 per tribe', N'2:30 – 3:00 PM', N'TBD', 1, N'The Lawn', N'Act it out — no words. Teammates race to guess before the clock runs out.', N'Charades verb cards', NULL, 0, 20);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'box')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('box', N'Surprise Box', 'b230', 1, N'1 per tribe', N'2:30 – 3:00 PM', N'TBD', 1, N'TBD', N'Reach in if you dare. What''s in the box? One brave player per tribe finds out.', N'The mystery box', NULL, 0, 21);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'song')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('song', N'Name That Song', 'b230', 2, N'2 per tribe', N'2:30 – 3:00 PM', N'10 pts', 0, N'Quiet spot off the DJ', N'A variety of songs play. First team to name the title scores. Most correct guesses in 60 seconds wins.', N'Speaker, playlist, phone, 8-ft table', NULL, 0, 22);

-- 3:00 PM Rotation
IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'memory')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('memory', N'Tribal Memory Game', 'b300', 5, N'5 per tribe', N'3:00 – 3:30 PM', N'20 pts', 1, N'The Cafe', N'Pairs view the icon sequence from the tribe leader, then recreate it on the grid. Up to four trips to the answer key, two players at a time. Ring the cowbell when finished.', N'20 icons, canvas grids, cowbells, timer', NULL, 0, 23);

-- Open Play · walk up anytime
IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'penny')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('penny', N'Penny Stacking', 'open', 0, N'Open play', N'Walk up anytime', N'5 pts', 0, N'The Cafe', N'Stack as many pennies as you can in one minute — using only one hand. Walk up anytime and take your shot.', N'$2–3 in pennies', NULL, 1, 24);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'hook')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('hook', N'Hook & Ring', 'open', 0, N'Open play', N'Walk up anytime', N'5 pts', 0, N'The Patio', N'Swing the hook and land it on the eye to score. Walk up anytime and take your shot.', N'Hook & eye game', NULL, 1, 25);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'suck')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('suck', N'Suck It Up', 'open', 0, N'Open play', N'Walk up anytime', N'5 pts', 0, N'The Cafe', N'Use suction from a straw to move 25 M&Ms from one plate to another in under a minute. Walk up anytime.', N'Plates, straws, M&Ms', NULL, 1, 26);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'state')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('state', N'State of Affairs', 'open', 0, N'Open play', N'Walk up anytime', N'10 pts', 0, N'The Cafe', N'Name as many state capitals as you can in 60 seconds — out loud or in writing. Walk up anytime.', N'2 laminated maps, answer key, paper', NULL, 1, 27);

IF NOT EXISTS (SELECT 1 FROM dbo.bo_games WHERE id = 'tpuzzle')
  INSERT INTO dbo.bo_games (id, name, block, cap, players, time_label, points_label, needs_ref, venue, descr, inventory, video_url, open_play, sort)
  VALUES ('tpuzzle', N'Tribal Puzzle', 'open', 0, N'Open play', N'Walk up anytime', N'5 pts', 0, N'The Cafe', N'Race the clock to complete the tribal puzzle. Walk up anytime — the player who finishes fastest scores.', N'2 puzzles from Etsy', NULL, 1, 28);

-- ── seed: relay legs (rl1–rl6, verbatim from the mockup) ────────────────────

IF NOT EXISTS (SELECT 1 FROM dbo.bo_relay_legs WHERE id = 'rl1')
  INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort)
  VALUES ('rl1', N'Tire Flip Sprint', 4, N'Flip the tractor tire down the lane, then tag the next leg.', 1);
IF NOT EXISTS (SELECT 1 FROM dbo.bo_relay_legs WHERE id = 'rl2')
  INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort)
  VALUES ('rl2', N'Water Bucket Brigade', 6, N'Pass the bucket down the line — most water still in it wins.', 2);
IF NOT EXISTS (SELECT 1 FROM dbo.bo_relay_legs WHERE id = 'rl3')
  INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort)
  VALUES ('rl3', N'Three-Legged Dash', 8, N'Paired at the ankle, race the cones and back.', 3);
IF NOT EXISTS (SELECT 1 FROM dbo.bo_relay_legs WHERE id = 'rl4')
  INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort)
  VALUES ('rl4', N'Sack Hop', 5, N'Hop the burlap sack to the flag and hand off.', 4);
IF NOT EXISTS (SELECT 1 FROM dbo.bo_relay_legs WHERE id = 'rl5')
  INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort)
  VALUES ('rl5', N'Paddle & Bag Carry', 4, N'Balance a cornhole bag on a paddle across the course.', 5);
IF NOT EXISTS (SELECT 1 FROM dbo.bo_relay_legs WHERE id = 'rl6')
  INSERT INTO dbo.bo_relay_legs (id, name, cap, descr, sort)
  VALUES ('rl6', N'Anchor Sprint', 3, N'The final straightaway — fastest legs bring it home.', 6);

-- ── seed: schedule (the 10 rows from the mockup's baseSchedule()) ───────────
-- IDs are IDENTITY, so guard on the table being empty rather than per-row.

IF NOT EXISTS (SELECT 1 FROM dbo.bo_schedule)
BEGIN
  INSERT INTO dbo.bo_schedule (time_label, ampm, title, place, kind, sort) VALUES
    (N'8:00',  N'AM', N'Check-In & Tribe Paint',        N'Main Lawn',            N'done', 1),
    (N'9:00',  N'AM', N'Opening Ceremony',              N'Main Lawn',            N'done', 2),
    (N'9:30',  N'AM', N'Minute-to-Win-It Rotations',    N'Cafe & Lawn',          N'done', 3),
    (N'10:30', N'AM', N'Bracket Battles Begin',         N'Courts · Lawn · Cafe', N'live', 4),
    (N'11:30', N'AM', N'Dip Off Judging',               N'The Cafe',             N'up',   5),
    (N'12:00', N'PM', N'Lunch & Halftime',              N'Main Lawn',            N'up',   6),
    (N'1:00',  N'PM', N'Inflatables & Field Games',     N'Parking Lot',          N'up',   7),
    (N'2:30',  N'PM', N'Relay & Trampoline Finals',     N'Trampolines',          N'up',   8),
    (N'3:30',  N'PM', N'Hidden Immunity Reveal',        N'Tribal Council',       N'up',   9),
    (N'4:00',  N'PM', N'Crown the Herd Champion',       N'Main Lawn',            N'up',  10);
END;
