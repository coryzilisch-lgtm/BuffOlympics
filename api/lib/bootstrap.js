const { sql } = require('./db');
const { formatName, userToJson } = require('./auth');
const cache = require('./cache');

// The shared (identical-for-everyone) half of the bootstrap payload is cached
// per host instance for a few seconds so a game-day crowd doesn't re-run the
// same dozen queries against the shared Fabric F4 capacity. Writes pass
// { fresh:true } (or call bustSharedBootstrap) so the mutator sees their change
// immediately and every other player picks it up on their next poll.
const SHARED_KEY = 'bootstrap:shared';
// Players poll every 60s and writers bypass the cache (fresh:true), so a 45s
// TTL is invisible to any single user while cutting crowd DB refills further —
// this also trims the cold-fill cost when Static Web Apps scales out to several
// Function instances under a burst (each keeps its own copy). Headcounts stay
// near-live regardless: every successful signup refreshes the shared copy, so
// the TTL is just a backstop for pure readers between writes.
const SHARED_TTL_MS = 45000;
function bustSharedBootstrap() { cache.bust(SHARED_KEY); }

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

// The 12 queries whose results are identical for every player — cached.
async function loadSharedBootstrap(pool, fresh) {
  if (!fresh) {
    const cached = cache.get(SHARED_KEY);
    if (cached) return cached;
  }
  const [
    settingsR, gamesR, slotsR, signupsR, scheduleR, usersR, dipR,
    legsR, relayR, annR, scoresR, refAssignR,
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
    pool.request().query('SELECT ISNULL(SUM(pts_buffalo), 0) AS buffalo, ISNULL(SUM(pts_roadhouse), 0) AS roadhouse FROM bo_results'),
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

  const shared = {
    settingsR, gamesR, slotsR, signupsR, scheduleR, usersR, dipR,
    legsR, relayR, annR, scoresR, refAssignR, idolsR, winPointsById, roundPointsById,
    schedEndById, gameTypeById, bracketRoundsByGame,
  };
  cache.set(SHARED_KEY, shared, SHARED_TTL_MS);
  return shared;
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
    schedEndById, gameTypeById, bracketRoundsByGame,
  } = shared;
  // Bracket payload for a game, or null. Undefined isBracket (pre-009) is left
  // for the frontend to resolve against its BRACKETS fallback.
  const bracketFor = (id) => {
    const rounds = bracketRoundsByGame[id] || [];
    if (!rounds.length) return null;
    const gt = gameTypeById[id] || {};
    return { intro: gt.bracketIntro || '', rounds };
  };
  const [myVoteR, myResultsR] = await Promise.all([
    pool.request().input('uid', sql.Int, uid)
      .query('SELECT dip_entry_id FROM bo_dip_votes WHERE user_id = @uid'),
    pool.request().input('pname', sql.NVarChar, myName)
      .query('SELECT game_name, detail, pts FROM bo_results WHERE player_name = @pname ORDER BY created_at DESC, id DESC'),
  ]);

  const settings = settingsFromRows(settingsR.recordset);

  // ── per-slot rosters ──
  const slotRoster = {};          // slotId -> { buffalo:[names], roadhouse:[names] }
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
    if (s.team === 'buffalo' || s.team === 'roadhouse') slotRoster[s.slot_id][s.team].push(name);
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
  const slotsByGame = {};
  for (const s of slotsR.recordset) {
    if (!slotsByGame[s.game_id]) slotsByGame[s.game_id] = [];
    const roster = slotRoster[s.id] || { buffalo: [], roadhouse: [] };
    slotsByGame[s.game_id].push({
      id: s.id,
      startMin: s.start_min,
      label: s.label,
      capBuffalo: s.cap_buffalo,
      capRoadhouse: s.cap_roadhouse,
      buffalo: roster.buffalo,
      roadhouse: roster.roadhouse,
      mine: mySlotIds.has(s.id),
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
      bracket: bracketFor(g.id),
      runtimeLabel: g.time_label || '',
      players: g.players || '',
      pointsLabel: g.points_label || '',
      descr: g.descr || '',
      inventory: g.inventory || '',
      videoUrl: g.video_url || '',
      slots: slotsByGame[g.id] || [],
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

    payload.allPlayers = usersR.recordset
      .filter(u => u.team === 'buffalo' || u.team === 'roadhouse')
      .map(u => ({ name: formatName(u.first_name, u.last_name, u.username), team: u.team }));

    // Every logged result (newest first) so refs can SEE what's been scored,
    // mark slots/rounds "Scored", and change a result. slot_label/round_label
    // are migration 010 — query defensively pre-010.
    let refResultsR;
    try {
      refResultsR = await pool.request().query(`
        SELECT TOP 300 id, game_name, detail, winner, pts, player_name,
               entered_by, entered_by_id, slot_label, round_label, created_at
        FROM bo_results ORDER BY created_at DESC, id DESC`);
    } catch (e) {
      refResultsR = await pool.request().query(`
        SELECT TOP 300 id, game_name, detail, winner, pts, player_name,
               entered_by, entered_by_id, created_at
        FROM bo_results ORDER BY created_at DESC, id DESC`);
    }
    payload.refResults = refResultsR.recordset.map(r => ({
      id: r.id,
      game: r.game_name,
      detail: r.detail || '',
      winner: r.winner || null,
      pts: r.pts,
      playerName: r.player_name || null,
      slotLabel: r.slot_label || null,
      roundLabel: r.round_label || null,
      enteredBy: r.entered_by || '',
      mine: r.entered_by_id === uid,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
  }

  return payload;
}

module.exports = {
  buildBootstrap, bustSharedBootstrap, getSettings, upsertSetting, settingsFromRows,
  stationType, slotsOverlap, signupMaxFor, SIGNUP_MAX_BUFFALO, SIGNUP_MAX_ROADHOUSE, SLOT_MINUTES,
};
