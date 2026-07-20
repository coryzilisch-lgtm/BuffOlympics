const { sql } = require('./db');
const { formatName, userToJson } = require('./auth');
const cache = require('./cache');

// The shared (identical-for-everyone) half of the bootstrap payload is cached
// per host instance so a game-day crowd doesn't re-run the same queries against
// the shared Fabric F4 capacity. It's split into TWO independently-busted blocks
// so a write only invalidates the half it actually changed:
//   • ROSTER  — games/slots/rosters/dip/relay/schedule/config. Changes on
//               sign-up / dip / relay / admin edits. A SCORE write leaves it be.
//   • RESULTS — scores/leaderboard/refResults. Changes on score writes. A
//               SIGN-UP write leaves it be, and it's SKIPPED ENTIRELY in sign-up
//               mode (nothing has been scored yet — zero result queries).
// Net: during the sign-up rush every signup rebuilds only rosters; during game
// day every score rebuilds only the small results block, not the whole roster.
const SHARED_ROSTER_KEY = 'bootstrap:roster';
const SHARED_RESULTS_KEY = 'bootstrap:results';
// Players poll every ~90s and writers bypass the cache (fresh:true), so a TTL
// LONGER than the poll interval lets a lone foregrounded reader's next poll hit
// the cache (0 shared queries) instead of refilling every time — the single
// biggest lever against idle-tab CU burn on our F4. Headcounts stay near-live
// regardless: every successful signup/score refreshes the relevant block, so
// the TTL is only a backstop for pure readers between writes. During a sign-up
// rush or active scoring, frequent writes keep it fresh; in quiet periods a
// ~2-minute staleness backstop is harmless.
const SHARED_TTL_MS = 120000;
// Roster edits + admin actions bust BOTH (safe default). Score writes call
// bustResultsBootstrap so they DON'T needlessly rebuild the roster half.
function bustSharedBootstrap() { cache.bust(SHARED_ROSTER_KEY); cache.bust(SHARED_RESULTS_KEY); }
function bustResultsBootstrap() { cache.bust(SHARED_RESULTS_KEY); }

// Per-tribe sign-up cap (relay + dip are separate). Texas Roadhouse brings
// more people, so each Roadie takes fewer slots to spread them around.
const SIGNUP_MAX_BUFFALO = 4;
const SIGNUP_MAX_ROADHOUSE = 2;
function signupMaxFor(team) {
  return team === 'roadhouse' ? SIGNUP_MAX_ROADHOUSE : SIGNUP_MAX_BUFFALO;
}
const SLOT_MINUTES = 5;        // each slot occupies a 5-minute window for overlap checks

// ── settings helpers ───────────────────────────────────────────────────────

function settingsFromRows(rows) {
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    eventMode: map.event_mode || 'signup',
    refJoinCode: map.ref_join_code || '',
    scoresRevealed: map.scores_revealed === '1',
    dipRevealed: map.dip_revealed === '1',
  };
}

async function getSettings(pool) {
  const r = await pool.request().query('SELECT [key], [value] FROM bo_settings');
  return settingsFromRows(r.recordset);
}

async function upsertSetting(pool, key, value) {
  await pool.request()
    .input('key', sql.NVarChar, key)
    .input('value', sql.NVarChar, String(value))
    .query(`
      IF EXISTS (SELECT 1 FROM bo_settings WHERE [key] = @key)
        UPDATE bo_settings SET [value] = @value WHERE [key] = @key;
      ELSE
        INSERT INTO bo_settings ([key], [value]) VALUES (@key, @value);
    `);
}

// Two 5-minute slots overlap when they start within SLOT_MINUTES of each other.
function slotsOverlap(a, b) {
  return Math.abs(a - b) < SLOT_MINUTES;
}

// Ref stations: walk-up for open play, otherwise head-to-head (Buffalo vs TXRH).
function stationType(g) {
  return g.open_play ? 'walk' : 'vs';
}

// ── the full bootstrap payload ─────────────────────────────────────────────
// Used by GET /api/bootstrap AND returned (wrapped as { bootstrap }) by every
// mutation endpoint per the contract.

// ── ROSTER block ──  games/slots/rosters/dip/relay/schedule + all game config.
// Identical for every viewer; changes only on sign-up / dip / relay / admin edits.
async function loadRosterBlock(pool, fresh) {
  if (!fresh) {
    const cached = cache.get(SHARED_ROSTER_KEY);
    if (cached) return cached;
  }
  const [
    settingsR, gamesR, slotsR, signupsR, scheduleR, usersR, dipR,
    legsR, relayR, annR, refAssignR,
  ] = await Promise.all([
    pool.request().query('SELECT [key], [value] FROM bo_settings'),
    pool.request().query(`
      SELECT id, name, needs_ref, venue, open_play, time_label,
             descr, inventory, players, points_label, video_url
      FROM bo_games ORDER BY sort, id`),
    pool.request().query(`
      SELECT id, game_id, start_min, label, cap_buffalo, cap_roadhouse
      FROM bo_game_slots ORDER BY game_id, sort, start_min`),
    pool.request().query(`
      SELECT s.slot_id, s.user_id, u.team, u.first_name, u.last_name, u.username
      FROM bo_signups s JOIN bo_users u ON u.id = s.user_id`),
    pool.request().query('SELECT id, time_label, ampm, title, place, kind FROM bo_schedule ORDER BY sort, id'),
    pool.request().query('SELECT id, first_name, last_name, username, team, is_ref, is_admin FROM bo_users'),
    pool.request().query(`
      SELECT d.id, d.user_id, d.team, d.created_at, u.first_name, u.last_name, u.username
      FROM bo_dip_entries d JOIN bo_users u ON u.id = d.user_id
      ORDER BY d.created_at, d.id`),
    pool.request().query('SELECT id, name, cap, descr FROM bo_relay_legs ORDER BY sort, id'),
    pool.request().query(`
      SELECT r.leg_id, r.user_id, u.team, u.first_name, u.last_name, u.username
      FROM bo_relay_signups r JOIN bo_users u ON u.id = r.user_id`),
    pool.request().query('SELECT TOP 20 id, title, body, created_at FROM bo_announcements ORDER BY created_at DESC, id DESC'),
    pool.request().query('SELECT game_id, user_id FROM bo_ref_assignments'),
  ]);

  // Idols live in their own table (migration 003; found_by/points 010). Query
  // defensively so the app still boots if a migration hasn't been run yet.
  let idolsR = { recordset: [] };
  try {
    idolsR = await pool.request().query(
      'SELECT id, title, clue, release_min, found, found_by, points, sort FROM bo_idols ORDER BY sort, id');
  } catch (e) {
    try {
      idolsR = await pool.request().query(
        'SELECT id, title, clue, release_min, found, sort FROM bo_idols ORDER BY sort, id');
    } catch (e2) { /* table not present yet — treat as no idols */ }
  }

  // Per-game win points (migration 004) + bracket round points (migration 010).
  // Defensive so the app boots pre-004 / pre-010.
  let winPointsById = {}, roundPointsById = {};
  try {
    const wpR = await pool.request().query('SELECT id, win_points, round_points FROM bo_games');
    for (const r of wpR.recordset) { winPointsById[r.id] = r.win_points; roundPointsById[r.id] = r.round_points; }
  } catch (e) {
    try {
      const wpR = await pool.request().query('SELECT id, win_points FROM bo_games');
      for (const r of wpR.recordset) winPointsById[r.id] = r.win_points;
    } catch (e2) { /* column not present yet — default applied below */ }
  }

  // Per-game team size + which team each player signed up with (migration 011).
  // Defensive so the app boots pre-011 — then every game is an individual game
  // (team_size 1) and team_no is ignored, exactly like today.
  let teamSizeById = {}, teamNoBySignup = {};
  try {
    const tsR = await pool.request().query('SELECT id, team_size FROM bo_games');
    for (const r of tsR.recordset) teamSizeById[r.id] = r.team_size;
  } catch (e) { /* column not present yet — every game individual */ }
  try {
    const tnR = await pool.request().query('SELECT slot_id, user_id, team_no FROM bo_signups');
    for (const r of tnR.recordset) teamNoBySignup[`${r.slot_id}:${r.user_id}`] = r.team_no;
  } catch (e) { /* column not present yet — team_no ignored */ }

  // Bracket-match structure on slots (migration 012): round_no + lane turn a
  // bracket game's slots into real matches with progression. Defensive pre-012.
  let slotBracketById = {};
  try {
    const sbR = await pool.request().query('SELECT id, round_no, lane FROM bo_game_slots');
    for (const r of sbR.recordset) slotBracketById[r.id] = { roundNo: r.round_no, lane: r.lane || null };
  } catch (e) { /* columns not present yet — no structured brackets */ }

  // Schedule end times (migration 006). Defensive so the app boots pre-006.
  let schedEndById = {};
  try {
    const seR = await pool.request().query('SELECT id, end_label, end_ampm FROM bo_schedule');
    for (const r of seR.recordset) schedEndById[r.id] = { endLabel: r.end_label || '', endAmpm: r.end_ampm || '' };
  } catch (e) { /* columns not present yet */ }

  // Game types (migration 009): head_to_head scoring flag + bracket flag/intro.
  // Defensive so the app boots pre-009 (frontend then falls back to its own
  // derivation: non-walk-up = head-to-head, and the hard-coded BRACKETS config).
  let gameTypeById = {};
  try {
    const gtR = await pool.request().query('SELECT id, head_to_head, is_bracket, bracket_intro FROM bo_games');
    for (const r of gtR.recordset) gameTypeById[r.id] = {
      headToHead: !!r.head_to_head, isBracket: !!r.is_bracket, bracketIntro: r.bracket_intro || '',
    };
  } catch (e) { /* columns not present yet */ }

  // Bracket rounds (migration 009). Shaped to match the old frontend BRACKETS
  // config so bracketPanel() renders unchanged.
  let bracketRoundsByGame = {};
  try {
    const brR = await pool.request().query(
      'SELECT game_id, sort, time_label, name, detail, team FROM bo_bracket_rounds ORDER BY game_id, sort, id');
    for (const r of brR.recordset) {
      if (!bracketRoundsByGame[r.game_id]) bracketRoundsByGame[r.game_id] = [];
      bracketRoundsByGame[r.game_id].push({
        time: r.time_label || '', name: r.name || '', detail: r.detail || '', team: r.team || 'both',
      });
    }
  } catch (e) { /* table not present yet */ }

  const roster = {
    settingsR, gamesR, slotsR, signupsR, scheduleR, usersR, dipR,
    legsR, relayR, annR, refAssignR, idolsR, winPointsById, roundPointsById,
    schedEndById, gameTypeById, bracketRoundsByGame, teamSizeById, teamNoBySignup, slotBracketById,
  };
  cache.set(SHARED_ROSTER_KEY, roster, SHARED_TTL_MS);
  return roster;
}

// ── RESULTS block ──  scores / leaderboard / refResults. Skipped entirely in
// sign-up mode (nothing scored yet → zero result queries); otherwise cached
// under its own key so a SIGN-UP write never rebuilds it and a SCORE write
// (bustResultsBootstrap) never rebuilds the roster half.
async function loadResultsBlock(pool, fresh, eventMode) {
  if (eventMode === 'signup') {
    return {
      scoresR: { recordset: [{ buffalo: 0, roadhouse: 0 }] },
      leaderboardR: { recordset: [] },
      refResultsR: { recordset: [] },
    };
  }
  if (!fresh) {
    const cached = cache.get(SHARED_RESULTS_KEY);
    if (cached) return cached;
  }

  const scoresR = await pool.request().query(
    'SELECT ISNULL(SUM(pts_buffalo), 0) AS buffalo, ISNULL(SUM(pts_roadhouse), 0) AS roadhouse FROM bo_results');

  // Leaderboard — points per scorer per tribe (drives top-10 + "your rank").
  // Rows are grouped by the result's player_name, so team results ("A & B")
  // rank as the pair — same matching rule as myResults.
  let leaderboardR = { recordset: [] };
  try {
    leaderboardR = await pool.request().query(`
      SELECT player_name, winner, SUM(pts) AS pts
      FROM bo_results
      WHERE player_name IS NOT NULL AND pts > 0 AND winner IN ('buffalo', 'roadhouse')
      GROUP BY player_name, winner`);
  } catch (e) { /* never fatal — leaderboard just stays empty */ }

  // Every logged result (newest first) — refs only, but IDENTICAL for every ref,
  // so it lives in the shared cached block instead of running per ref-request.
  // A `TOP 2000` scan on every ref poll was one of the heaviest game-day costs;
  // caching it here means one scan per refill. The per-user `mine` flag is
  // applied in the ref section below. slot_id/slot_label/round_label are
  // migrations 010/012 — query defensively so it still boots pre-migration.
  let refResultsR;
  try {
    refResultsR = await pool.request().query(`
      SELECT TOP 2000 id, game_name, detail, winner, pts, player_name,
             entered_by, entered_by_id, slot_label, round_label, slot_id, created_at
      FROM bo_results ORDER BY created_at DESC, id DESC`);
  } catch (e012) {
    try {
      refResultsR = await pool.request().query(`
        SELECT TOP 2000 id, game_name, detail, winner, pts, player_name,
               entered_by, entered_by_id, slot_label, round_label, created_at
        FROM bo_results ORDER BY created_at DESC, id DESC`);
    } catch (e) {
      refResultsR = await pool.request().query(`
        SELECT TOP 2000 id, game_name, detail, winner, pts, player_name,
               entered_by, entered_by_id, created_at
        FROM bo_results ORDER BY created_at DESC, id DESC`);
    }
  }

  const results = { scoresR, leaderboardR, refResultsR };
  cache.set(SHARED_RESULTS_KEY, results, SHARED_TTL_MS);
  return results;
}

// Merge the two cached blocks into the one shape buildBootstrap consumes. The
// event mode (from the roster block's settings) decides whether results run.
async function loadSharedBootstrap(pool, fresh) {
  const roster = await loadRosterBlock(pool, fresh);
  const eventMode = settingsFromRows(roster.settingsR.recordset).eventMode;
  const results = await loadResultsBlock(pool, fresh, eventMode);
  return { ...roster, ...results };
}

async function buildBootstrap(pool, user, opts = {}) {
  const uid = user.id;
  const myTeam = user.team === 'roadhouse' ? 'roadhouse' : (user.team === 'buffalo' ? 'buffalo' : null);
  const myName = formatName(user.first_name, user.last_name, user.username);

  // Shared block (cached); the two per-user queries always run live.
  const shared = await loadSharedBootstrap(pool, opts.fresh);
  const {
    settingsR, gamesR, slotsR, signupsR, scheduleR, usersR, dipR,
    legsR, relayR, annR, scoresR, refAssignR, idolsR, winPointsById, roundPointsById,
    schedEndById, gameTypeById, bracketRoundsByGame, teamSizeById, teamNoBySignup, slotBracketById,
    leaderboardR, refResultsR,
  } = shared;
  // Bracket payload for a game, or null. Undefined isBracket (pre-009) is left
  // for the frontend to resolve against its BRACKETS fallback.
  const bracketFor = (id) => {
    const rounds = bracketRoundsByGame[id] || [];
    if (!rounds.length) return null;
    const gt = gameTypeById[id] || {};
    return { intro: gt.bracketIntro || '', rounds };
  };
  const settings = settingsFromRows(settingsR.recordset);

  // The two per-user queries are the ONLY DB cost that can't be shared/cached —
  // they run live on every poll. In sign-up mode both are pointless: dip voting
  // opens on Game Day (no votes yet) and nothing has been scored (no results),
  // so skip them entirely and hand back empty results. That's zero per-user DB
  // work per poll during the sign-up rush.
  let myVoteR = { recordset: [] }, myResultsR = { recordset: [] };
  if (settings.eventMode !== 'signup') {
    [myVoteR, myResultsR] = await Promise.all([
      pool.request().input('uid', sql.Int, uid)
        .query('SELECT dip_entry_id FROM bo_dip_votes WHERE user_id = @uid'),
      pool.request().input('pname', sql.NVarChar, myName)
        .query(`
          SELECT game_name, detail, pts FROM bo_results
          WHERE player_name = @pname
             OR player_name LIKE @pname + ' & %'
             OR player_name LIKE '% & ' + @pname
             OR player_name LIKE '% & ' + @pname + ' & %'
          ORDER BY created_at DESC, id DESC`),
    ]);
  }

  // ── per-slot rosters ──
  const slotRoster = {};          // slotId -> { buffalo:[names], roadhouse:[names] }
  const slotTeamNo = {};          // slotId -> { buffalo:[teamNos], roadhouse:[teamNos] } (aligned w/ names)
  const mySlotIds = new Set();
  const signupPeopleByGame = {};  // gameId -> [{ name, team, slot, startMin }]  (for ref stations)
  const slotGameId = {};          // slotId -> gameId  (filled below)
  const slotMeta = {};            // slotId -> { label, startMin }
  for (const s of slotsR.recordset) {
    slotGameId[s.id] = s.game_id;
    slotMeta[s.id] = { label: s.label, startMin: s.start_min };
  }
  for (const s of signupsR.recordset) {
    const name = formatName(s.first_name, s.last_name, s.username);
    if (!slotRoster[s.slot_id]) slotRoster[s.slot_id] = { buffalo: [], roadhouse: [] };
    if (!slotTeamNo[s.slot_id]) slotTeamNo[s.slot_id] = { buffalo: [], roadhouse: [] };
    if (s.team === 'buffalo' || s.team === 'roadhouse') {
      slotRoster[s.slot_id][s.team].push(name);
      const no = teamNoBySignup[`${s.slot_id}:${s.user_id}`];
      slotTeamNo[s.slot_id][s.team].push(no && no > 0 ? no : 1);
    }
    if (s.user_id === uid) mySlotIds.add(s.slot_id);
    const gid = slotGameId[s.slot_id];
    if (gid) {
      if (!signupPeopleByGame[gid]) signupPeopleByGame[gid] = [];
      const meta = slotMeta[s.slot_id] || {};
      signupPeopleByGame[gid].push({ name, team: s.team || null, slot: meta.label || '', startMin: meta.startMin ?? null });
    }
  }
  // Order each game's ref roster by slot time so refs work top-to-bottom.
  for (const gid of Object.keys(signupPeopleByGame)) {
    signupPeopleByGame[gid].sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  }

  // ── slots grouped by game ──
  // For team games (team_size ≥ 2) each tribe's roster is split into teams so
  // players pick a teammate at sign-up and refs score each team. numTeams for a
  // tribe = floor(cap / team_size). buffaloTeams/roadhouseTeams are arrays of
  // teams (each an array of member names); null for individual games. The flat
  // buffalo/roadhouse name arrays are kept unchanged for back-compat.
  const buildTeams = (names, nos, cap, ts) => {
    if (!ts || ts < 2) return null;
    // No seats for this tribe → no teams (a 0-cap lane slot must not render a
    // phantom "Team 1" for the tribe that isn't in it).
    if (!cap || cap <= 0) return [];
    const numTeams = Math.max(1, Math.floor(cap / ts));
    const teams = Array.from({ length: numTeams }, () => []);
    names.forEach((nm, i) => {
      let no = nos && nos[i] > 0 ? nos[i] : 1;
      if (no > numTeams) no = numTeams;   // clamp any stray team_no into range
      teams[no - 1].push(nm);
    });
    return teams;
  };
  const slotsByGame = {};
  for (const s of slotsR.recordset) {
    if (!slotsByGame[s.game_id]) slotsByGame[s.game_id] = [];
    const roster = slotRoster[s.id] || { buffalo: [], roadhouse: [] };
    const nos = slotTeamNo[s.id] || { buffalo: [], roadhouse: [] };
    const tsRaw = teamSizeById[s.game_id];
    const ts = tsRaw && tsRaw >= 2 ? tsRaw : 1;
    slotsByGame[s.game_id].push({
      id: s.id,
      startMin: s.start_min,
      label: s.label,
      capBuffalo: s.cap_buffalo,
      capRoadhouse: s.cap_roadhouse,
      buffalo: roster.buffalo,
      roadhouse: roster.roadhouse,
      teamSize: ts,
      buffaloTeams: buildTeams(roster.buffalo, nos.buffalo, s.cap_buffalo, ts),
      roadhouseTeams: buildTeams(roster.roadhouse, nos.roadhouse, s.cap_roadhouse, ts),
      roundNo: (slotBracketById[s.id] || {}).roundNo ?? null,   // migration 012 — bracket match round
      lane: (slotBracketById[s.id] || {}).lane || null,         // 'buffalo' | 'roadhouse' | 'final' | null
      mine: mySlotIds.has(s.id),
      // Which team (1-based) the CALLER joined in this slot — identity-based,
      // so display-name twins can't make the UI think you're on their team.
      myTeamNo: mySlotIds.has(s.id) ? (teamNoBySignup[`${s.id}:${uid}`] || 1) : null,
    });
  }

  // ── my picks (for overlap + the "My games" rail) ──
  const slotById = {};
  for (const s of slotsR.recordset) slotById[s.id] = s;
  const gameNameById = {};
  for (const g of gamesR.recordset) gameNameById[g.id] = g.name;
  const mySignups = [...mySlotIds].map(id => {
    const s = slotById[id];
    return s ? {
      slotId: id, gameId: s.game_id, game: gameNameById[s.game_id] || s.game_id,
      label: s.label, startMin: s.start_min,
    } : null;
  }).filter(Boolean).sort((a, b) => a.startMin - b.startMin);

  // Tribe privacy is enforced SERVER-side: plain players never receive the
  // other tribe's slot rosters (the UI hides them, but the payload must not
  // leak them either — dev tools would show every pick). Refs and admins need
  // both sides (scoring / admin views), so they get the full slots.
  const isRefOrAdmin = !!(user.is_ref || user.is_admin);
  const stripOtherTribe = (s) => {
    if (isRefOrAdmin || !myTeam) return s;
    const other = myTeam === 'buffalo' ? 'roadhouse' : 'buffalo';
    return {
      ...s,
      [other]: [],
      [other + 'Teams']: s[other + 'Teams'] ? s[other + 'Teams'].map(() => []) : s[other + 'Teams'],
    };
  };
  const games = gamesR.recordset.map(g => {
    const gt = gameTypeById[g.id] || {};
    return {
      id: g.id,
      name: g.name,
      needsRef: !!g.needs_ref,
      venue: g.venue,
      openPlay: !!g.open_play,
      // head_to_head drives ref scoring (winner-picker vs type-a-number). Pre-009
      // it falls back to the old derivation: non-walk-up games were head-to-head.
      headToHead: gt.headToHead !== undefined ? gt.headToHead : !g.open_play,
      isBracket: gt.isBracket,                 // undefined pre-009 → frontend uses BRACKETS fallback
      teamSize: (teamSizeById[g.id] && teamSizeById[g.id] >= 2) ? teamSizeById[g.id] : 1,  // migration 011; 1 = individuals
      bracket: bracketFor(g.id),
      runtimeLabel: g.time_label || '',
      players: g.players || '',
      pointsLabel: g.points_label || '',
      descr: g.descr || '',
      inventory: g.inventory || '',
      videoUrl: g.video_url || '',
      slots: (slotsByGame[g.id] || []).map(stripOtherTribe),
      mySlotId: (slotsByGame[g.id] || []).find(s => s.mine)?.id ?? null,
      mine: (slotsByGame[g.id] || []).some(s => s.mine),
    };
  });

  // ── schedule ──
  const schedule = scheduleR.recordset.map(r => ({
    id: r.id, timeLabel: r.time_label, ampm: r.ampm, title: r.title, place: r.place, kind: r.kind,
    endLabel: (schedEndById[r.id] || {}).endLabel || '', endAmpm: (schedEndById[r.id] || {}).endAmpm || '',
  }));

  // ── tribes ──
  const roleRank = u => (u.is_admin ? 0 : u.is_ref ? 1 : 2);
  const tribes = { buffalo: [], roadhouse: [] };
  const teamUsers = usersR.recordset.filter(u => u.team === 'buffalo' || u.team === 'roadhouse');
  teamUsers.sort((a, b) => roleRank(a) - roleRank(b)
    || formatName(a.first_name, a.last_name, a.username).localeCompare(formatName(b.first_name, b.last_name, b.username)));
  for (const u of teamUsers) {
    tribes[u.team].push({
      name: formatName(u.first_name, u.last_name, u.username),
      role: u.is_ref ? 'SUP Ref' : '',
    });
  }

  // ── dip off ──
  const dipCounts = { buffalo: 0, roadhouse: 0 };
  const dipEntries = [];
  let myEntry = false;
  for (const d of dipR.recordset) {
    const team = d.team === 'roadhouse' ? 'roadhouse' : 'buffalo';
    dipCounts[team] += 1;
    const isMine = d.user_id === uid;
    if (isMine) myEntry = true;
    dipEntries.push({
      id: d.id,
      no: dipEntries.length + 1,
      team,
      name: team === user.team ? formatName(d.first_name, d.last_name, d.username) : null,
      isMine,
    });
  }
  const myVote = myVoteR.recordset.length ? myVoteR.recordset[0].dip_entry_id : null;

  // ── relay ──
  const legs = legsR.recordset.map(l => ({ id: l.id, name: l.name, cap: l.cap, desc: l.descr }));
  const relayRoster = {};
  for (const l of legs) relayRoster[l.id] = { buffalo: [], roadhouse: [] };
  let myLeg = null;
  for (const r of relayR.recordset) {
    if (!relayRoster[r.leg_id]) relayRoster[r.leg_id] = { buffalo: [], roadhouse: [] };
    if (r.team === 'buffalo' || r.team === 'roadhouse') {
      relayRoster[r.leg_id][r.team].push(formatName(r.first_name, r.last_name, r.username));
    }
    if (r.user_id === uid) myLeg = r.leg_id;
  }

  // ── announcements / my results / scores ──
  const announcements = annR.recordset.map(a => ({
    id: a.id, title: a.title, body: a.body,
    createdAt: a.created_at ? new Date(a.created_at).toISOString() : null,
  }));

  const myResults = myResultsR.recordset.map(r => ({ game: r.game_name, detail: r.detail, pts: r.pts }));

  const totals = scoresR.recordset[0] || { buffalo: 0, roadhouse: 0 };
  const scores = settings.scoresRevealed
    ? { revealed: true, buffalo: totals.buffalo, roadhouse: totals.roadhouse }
    : { revealed: false };

  // Idol clues. Clues are HIDDEN by default — the client reveals a clue once
  // its release time (release_min, event-local) passes on the viewer's clock,
  // or once an admin marks it found. We always send the fields; the UI gates
  // the reveal so a locked clue reads as "unlocks at …".
  const idols = (idolsR.recordset || []).map(x => ({
    id: x.id,
    title: x.title || '',
    clue: x.clue || '',
    releaseMin: x.release_min == null ? null : x.release_min,
    found: !!x.found,
    foundBy: x.found_by || null,          // migration 010 — finder's name
    points: x.points == null ? null : x.points,   // migration 010 — what it's worth
  }));

  const payload = {
    user: userToJson(user),
    settings: {
      eventMode: settings.eventMode,
      scoresRevealed: settings.scoresRevealed,
      dipRevealed: settings.dipRevealed,
    },
    serverTime: new Date().toISOString(),
    games,
    mySignups,
    signupCount: mySignups.length,
    signupMax: signupMaxFor(myTeam),
    schedule,
    tribes,
    dip: { counts: dipCounts, entries: dipEntries, myEntry, myVote },
    relay: { legs, roster: relayRoster, myLeg },
    idols,
    announcements,
    myResults,
    scores,
    leaderboard: (() => {
      // Top-10 scorers per tribe + the caller's rank within their own tribe.
      // Ranks use competition ranking (ties share a rank). A pair entry
      // ("A & B") ranks as the pair, same as myResults matching.
      const rows = (leaderboardR && leaderboardR.recordset) || [];
      const byTeam = { buffalo: [], roadhouse: [] };
      for (const r of rows) {
        if (byTeam[r.winner]) byTeam[r.winner].push({ name: r.player_name, pts: r.pts });
      }
      for (const t of ['buffalo', 'roadhouse']) byTeam[t].sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
      // A pair entry ("A & B") involves both members — team-game winners see
      // their pair points as their own instead of "No points yet".
      const involves = (entryName, name) => entryName === name || entryName.split(' & ').includes(name);
      const mine = myTeam ? byTeam[myTeam] : null;
      let myRank = null, myPts = 0;
      if (mine) {
        const myRows = mine.filter(x => involves(x.name, myName));
        if (myRows.length) {
          myPts = myRows.reduce((a, x) => a + x.pts, 0);
          myRank = 1 + mine.filter(x => !involves(x.name, myName) && x.pts > myPts).length;
        }
      }
      return {
        buffalo: byTeam.buffalo.slice(0, 10),
        roadhouse: byTeam.roadhouse.slice(0, 10),
        myRank,
        myPts,
        tribeCount: mine ? mine.length : 0,
      };
    })(),
  };

  // ── referees only (admins are NOT refs — they use the Admin Center) ──
  if (user.is_ref) {
    // Multiple refs can hold the same game (migration 010) — gameId -> [uid,…].
    const assignedBy = {};
    for (const a of refAssignR.recordset) {
      if (!assignedBy[a.game_id]) assignedBy[a.game_id] = [];
      assignedBy[a.game_id].push(a.user_id);
    }
    const nameById = {};
    for (const u of usersR.recordset) nameById[u.id] = formatName(u.first_name, u.last_name, u.username);

    // A ref only sees the games they've ADDED to their list (walk-up games
    // included — they're claimed like any other game, not auto-added).
    const assignedGames = gamesR.recordset.filter(g => (assignedBy[g.id] || []).includes(uid));
    payload.refStations = assignedGames.map(g => {
      const gt = gameTypeById[g.id] || {};
      const headToHead = gt.headToHead !== undefined ? gt.headToHead : !g.open_play;
      return {
        gameId: g.id,
        name: g.name,
        venue: g.venue,
        timeLabel: g.time_label,
        // 'vs' → winner-picker, 'walk' → variable score per team.
        type: headToHead ? 'vs' : 'walk',
        headToHead,
        teamSize: (teamSizeById[g.id] && teamSizeById[g.id] >= 2) ? teamSizeById[g.id] : 1,  // migration 011
        isBracket: gt.isBracket,           // undefined pre-009 → ref board uses BRACKETS fallback
        bracket: bracketFor(g.id),         // rounds for the ref bracket path (migration 009)
        openPlay: !!g.open_play,
        winPoints: winPointsById[g.id] != null ? winPointsById[g.id] : 10,
        // Points a within-tribe bracket-round win awards (migration 010).
        // NULL pre-010 → 0 (advancement only, the old behavior).
        roundPoints: roundPointsById[g.id] != null ? roundPointsById[g.id] : 0,
        slots: slotsByGame[g.id] || [],
        signups: signupPeopleByGame[g.id] || [],
      };
    });

    // Every game, with everyone reffing it — powers the ref Games tab where any
    // ref adds any game to their list (uncapped, never bumps another ref).
    payload.refGames = gamesR.recordset.map(g => {
      const rids = assignedBy[g.id] || [];
      return {
        gameId: g.id, name: g.name, venue: g.venue, timeLabel: g.time_label,
        openPlay: !!g.open_play, needsRef: !!g.needs_ref,
        refNames: rids.map(id => nameById[id] || '').filter(Boolean),
        mine: rids.includes(uid),
        slotCount: (slotsByGame[g.id] || []).length,
      };
    });

    // Dedupe by display name + team: results and rosters key on the display
    // string, so two accounts rendering identically would show as confusing
    // duplicate rows in the ref walk-on picker (and scoring "each" of them
    // would double-count). One row per distinct name is the honest view.
    const seenPlayer = new Set();
    payload.allPlayers = usersR.recordset
      .filter(u => u.team === 'buffalo' || u.team === 'roadhouse')
      .map(u => ({ name: formatName(u.first_name, u.last_name, u.username), team: u.team }))
      .filter(p => {
        const k = p.team + '|' + p.name;
        if (seenPlayer.has(k)) return false;
        seenPlayer.add(k);
        return true;
      });

    // Logged results come from the shared cached block (identical for every ref);
    // here we only apply the per-user `mine` flag.
    payload.refResults = refResultsR.recordset.map(r => ({
      id: r.id,
      game: r.game_name,
      detail: r.detail || '',
      winner: r.winner || null,
      pts: r.pts,
      playerName: r.player_name || null,
      slotLabel: r.slot_label || null,
      roundLabel: r.round_label || null,
      slotId: r.slot_id != null ? r.slot_id : null,   // migration 012 — pins the result to ONE slot
      enteredBy: r.entered_by || '',
      mine: r.entered_by_id === uid,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
  }

  return payload;
}

module.exports = {
  buildBootstrap, bustSharedBootstrap, bustResultsBootstrap, getSettings, upsertSetting, settingsFromRows,
  stationType, slotsOverlap, signupMaxFor, SIGNUP_MAX_BUFFALO, SIGNUP_MAX_ROADHOUSE, SLOT_MINUTES,
};
