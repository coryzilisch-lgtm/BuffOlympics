-- ============================================================================
-- Buff Olympics — 007_game_details.sql
-- Populates bo_games.descr / inventory / players / points_label (and
-- win_points / needs_ref where the source doc is explicit) from the
-- "Minute to Win It Games" rules doc. Targeted UPDATEs by stable game id —
-- does NOT touch bo_game_slots or bo_signups, safe to run mid-event.
-- Idempotent — re-running just re-applies the same text. Games not covered
-- by the doc (golf-putt, puzzle) are left untouched.
-- Run in the Fabric portal SQL query editor. NO `USE`/`GO`/TRUNCATE.
-- ============================================================================

UPDATE dbo.bo_games SET
  players = N'2 players per team',
  points_label = N'5 points to the team with the most hoops on their teammate',
  descr = N'Using hula hoops, create a human ring toss — players attempt to get the most hoops around their partner as possible within one minute.',
  inventory = N'6-8 hula hoops (SUP provides 20)'
WHERE id = 'unity-circle';

UPDATE dbo.bo_games SET
  players = N'1 player at a time',
  points_label = N'1 point per 2 pennies stacked (10 pennies = 5 pts, 20 = 10 pts, 30 = 15 pts)',
  descr = N'Stack as many pennies as you can in one minute using only one hand. Points are awarded in pairs — an odd stack scores for the last completed pair (11 pennies still scores 5, 21 scores 10).',
  inventory = N'$2-3 in pennies'
WHERE id = 'totem-tower';

UPDATE dbo.bo_games SET
  players = N'1 player at a time',
  points_label = N'5 points if successful',
  descr = N'Swing the hook as many times as you can in 60 seconds. Landing the hook on the ring scores.',
  inventory = N'Hook and eye game'
WHERE id = 'hook-ring';

UPDATE dbo.bo_games SET
  players = N'2 players per team',
  points_label = N'1 point per correct song guess — 10 points if successful',
  descr = N'One Buffalo player and one TXRH player compete head-to-head. The ref plays song clips — first to correctly name the song scores a point for their team. Each teammate gets 3 songs, then the next pair goes. Most correct guesses wins the challenge.',
  inventory = N'8-foot table, speaker or headphones, playlist on a phone/iPod, quiet spot away from the DJ'
WHERE id = 'name-that-song';

UPDATE dbo.bo_games SET
  players = N'1 player at a time',
  points_label = N'Most M&Ms transferred earns 10 points',
  descr = N'Use suction from a straw to transfer 25 M&Ms from one plate to another in under a minute.',
  inventory = N'Plates, straws, M&Ms, container for the M&Ms'
WHERE id = 'suck-it-up';

UPDATE dbo.bo_games SET
  players = N'1 player at a time',
  points_label = N'10 points if successful',
  descr = N'Identify and write down as many U.S. state capitals as you can in 60 seconds, placing each correctly spelled capital in the right state on the map.',
  inventory = N'2 laminated maps, an answer key for the judge, paper for contestants'
WHERE id = 'state-of-affairs';

UPDATE dbo.bo_games SET
  players = N'2 players at a time',
  points_label = N'10 points if successful',
  descr = N'Partners sit back-to-back on the floor with arms linked, then stand up together without unlinking arms, sit back down, and repeat. Each full stand-and-sit is one rep — most reps in 60 seconds wins.',
  inventory = N'Nothing needed'
WHERE id = 'alliance-lift';

UPDATE dbo.bo_games SET
  players = N'2 players (1 Buffalo, 1 TXRH)',
  points_label = N'15 points to the player who completes the most of the puzzle',
  descr = N'One Buffalo teammate and one TXRH teammate compete head-to-head — each has 2 minutes to complete the puzzle. If neither finishes, the ref decides who got closest.',
  inventory = N'2 puzzles, timer'
WHERE id = 'firekeepers-puzzle';

UPDATE dbo.bo_games SET
  players = N'4 teams of 2',
  points_label = N'1 point on the board, 3 in the hole — qualifying to 11, championship to 21 (tiebreak to 25)',
  descr = N'Players alternate throws; feet may not go past the front edge of the board. A bag that touches the ground before landing on the board must be removed before the next throw.',
  inventory = N'Cornhole boards and bags'
WHERE id = 'cornhole';

UPDATE dbo.bo_games SET
  players = N'5 teammates per team',
  points_label = N'15 points for the successful team',
  descr = N'Flip your "island" (a bedsheet) completely over without any team member stepping off it. If any player touches the ground, the team starts over. First team to flip wins.',
  inventory = N'2 bed sheets',
  win_points = 15
WHERE id = 'island-flip';

UPDATE dbo.bo_games SET
  players = N'1 player at a time',
  points_label = N'Max 12 points — 1 point per target shot down',
  descr = N'Choose your Nerf gun. You get 12 bullets to shoot down all 12 targets.',
  inventory = N'Nerf guns, bullets, and shooting machine (provided)',
  win_points = 12
WHERE id = 'sharpshooter';

UPDATE dbo.bo_games SET
  players = N'4 players, 2 teams of 2',
  points_label = N'10 points',
  descr = N'Teams alternate throwing a table-tennis ball into the other team''s cups. A landed ball removes that cup and the opponent drinks its contents. If both teammates hit cups on the same turn, the balls are rolled back for another shot.',
  inventory = N'Table, cups, and balls (SUP provides)',
  win_points = 10,
  needs_ref = 0
WHERE id = 'beer-pong';

UPDATE dbo.bo_games SET
  players = N'1 player at a time',
  points_label = N'Ball 1 = 5 pts, ball 2 = 10 pts, ball 3 = 15 pts, all the way through = 25 pts',
  descr = N'Try to cross the big inflatable balls! Score more points the further you make it across.',
  win_points = 25
WHERE id = 'inflatable-wipeout';

UPDATE dbo.bo_games SET
  players = N'1 player from each team per heat, 5 players total',
  points_label = N'10 points to the first to the finish line',
  descr = N'Racers head down the parking lot toward the finish line — first to arrive scores for their team.',
  inventory = N'Big wheels, cones',
  win_points = 10
WHERE id = 'big-wheels';

UPDATE dbo.bo_games SET
  players = N'5 players per team',
  points_label = N'20 points',
  descr = N'Each team has its own unique answer key. One player at a time may view it once before another teammate takes a turn. Players rely on memory to recreate the correct arrangement — when the team believes it''s correct, they ring the cowbell for the ref to check. First team to complete it correctly wins.',
  inventory = N'2 sets of 20 icons, 2 canvas grid sheets, 2 cowbells',
  win_points = 20
WHERE id = 'outwit-memory';

UPDATE dbo.bo_games SET
  players = N'1 player per team',
  points_label = N'15 points to the winner',
  descr = N'One Buffalo teammate and one TXRH teammate compete head-to-head. Using the control handles, guide the ball through the maze — if it falls in a hole, return it to the start and try again.',
  win_points = 15
WHERE id = 'sacred-passage';

UPDATE dbo.bo_games SET
  players = N'2 players per team (6 needed total)',
  descr = N'The seated partner knows the clue and shouts instructions to guide the standing partner''s body movements — no saying clue words, no hands. The standing partner guesses the clue from what their body is doing.',
  inventory = N'Cards with charades verbs'
WHERE id = 'charades-team-game';

UPDATE dbo.bo_games SET
  players = N'1 player',
  points_label = N'Max 20 points',
  descr = N'Roll 9 balls up the inclined ramp into the circular target holes — score the most points to win.',
  win_points = 20
WHERE id = 'inflatable-skee-ball';

UPDATE dbo.bo_games SET
  players = N'1 player per team',
  points_label = N'Max 20 points',
  descr = N'Aim your bow at the target and try for a bullseye — points are awarded based on where your arrows land.',
  win_points = 20
WHERE id = 'inflatable-archery';

UPDATE dbo.bo_games SET
  players = N'4 players, 2 teams',
  points_label = N'First to 15, win by 2',
  descr = N'The ball must bounce once on your side before you return it. Service changes every 2 points; at 10-10 (deuce), service alternates every point.',
  inventory = N'Paddles, balls, ping pong table'
WHERE id = 'ping-pong';

UPDATE dbo.bo_games SET
  players = N'3 players per team (2 teams)',
  points_label = N'15 points to the team of the player with the fewest letters',
  descr = N'The classic game of BUFFS — an elimination challenge where players take turns creating and matching trick shots. Miss a match and you get a letter; first to spell B-U-F-F-S is eliminated.',
  inventory = N'4-6 basketballs',
  win_points = 15,
  needs_ref = 0
WHERE id = 'horse-bb';

UPDATE dbo.bo_games SET
  players = N'2 players per team',
  points_label = N'25 points',
  descr = N'Each player stands between two walls with one foot on each starting foothold, bracing against the walls for balance (no grabbing the top support beam). Every 2 minutes a judge signals players down to the next, smaller foothold level. Touch the ground and you''re eliminated — last player on the wall wins.',
  win_points = 25
WHERE id = 'cliffhanger';

UPDATE dbo.bo_games SET
  players = N'1 player from each team',
  points_label = N'20 points',
  descr = N'Hold two mugs of water out with arms fully extended for as long as possible — the longer you hold out, the better your team''s time.',
  inventory = N'4 plastic mugs, timer, water bucket to fill the mugs',
  win_points = 20
WHERE id = 'grip-and-survive';

UPDATE dbo.bo_games SET
  players = N'1 player from each team',
  points_label = N'Max 25 points — 5 points per correct guess (5 objects)',
  descr = N'One Buffalo teammate and one TXRH teammate compete head-to-head, blindfolded. Each has 15 seconds to feel a hidden object through the arm holes (no peeking) and write down a guess before moving to the next of 5 mystery objects.',
  inventory = N'Mystery box, blindfolds, 5 items per round, pen and paper',
  win_points = 25
WHERE id = 'what-s-lurking';

UPDATE dbo.bo_games SET
  players = N'1 player per team',
  points_label = N'2 points per sandbag landed on a platform',
  descr = N'Standing behind the throwing line, toss sandbags one at a time toward the spiral tower, aiming to land each on a metal platform. A bag only counts if it comes to rest completely on a platform — bags that fall or bounce off don''t score. Both teams get 5 minutes.',
  inventory = N'20 colored sandbags (10 of each color)',
  win_points = 20
WHERE id = 'spiral-architect';

UPDATE dbo.bo_games SET
  players = N'4 teams of 2',
  points_label = N'First to 15, win by at least 2',
  descr = N'Rally scoring — every rally results in a point for the server or receiver. On the serve and return, the ball must bounce once before being hit; after that it can be volleyed or played off a bounce.',
  inventory = N'Pickleball net, paddles, whiffle balls, chalk for the court outline',
  needs_ref = 0
WHERE id = 'pickleball';
