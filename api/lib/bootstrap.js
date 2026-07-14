const { sql } = require('./db');
const { formatName, userToJson } = require('./auth');
const cache = require('./cache');

// The shared (identical-for-everyone) half of the bootstrap payload is cached
// per host instance for a few seconds so a game-day crowd doesn't re-run the
// same dozen queries against the small Fabric F2 capacity. Writes pass
// { fresh:true } (or call bustSharedBootstrap) so the mutator sees their change
// immediately and every other player picks it up on their next poll.
const SHARED_KEY = 'bootstrap:shared';
// Players poll every 60s and writers bypass the cache (fresh:true), so a ~20s
// TTL is invisible to any single user while cutting crowd DB refills to ~3/min.
const SHARED_TTL_MS = 20000;
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
      SELECT id, name, needs_ref, venue, open_play, time_label
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
  // Idols live in their own table (migration 003). Query defensively so the
  // app still boots if 003 hasn't been run yet in the Fabric portal.
  let idolsR = { recordset: [] };
  try {
    idolsR = await pool.request().query(
      'SELECT id, title, clue, release_min, found, sort FROM bo_idols ORDER BY sort, id');
  } catch (e) { /* table not present yet — treat as no idols */ }

  const shared = {
    settingsR, gamesR, slotsR, signupsR, scheduleR, usersR, dipR,
    legsR, relayR, annR, scoresR, refAssignR, idolsR,
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
    legsR, relayR, annR, scoresR, refAssignR, idolsR,
  } = shared;
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

  const games = gamesR.recordset.map(g => ({
    id: g.id,
    name: g.name,
    needsRef: !!g.needs_ref,
    venue: g.venue,
    openPlay: !!g.open_play,
    runtimeLabel: g.time_label || '',
    slots: slotsByGame[g.id] || [],
    mySlotId: (slotsByGame[g.id] || []).find(s => s.mine)?.id ?? null,
    mine: (slotsByGame[g.id] || []).some(s => s.mine),
  }));

  // ── schedule ──
  const schedule = scheduleR.recordset.map(r => ({
    id: r.id, timeLabel: r.time_label, ampm: r.ampm, title: r.title, place: r.place, kind: r.kind,
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
    const assignments = {};
    for (const a of refAssignR.recordset) assignments[a.game_id] = a.user_id;

    const stations = gamesR.recordset.filter(g =>
      g.open_play || assignments[g.id] === uid);

    payload.refStations = stations.map(g => ({
      gameId: g.id,
      name: g.name,
      venue: g.venue,
      timeLabel: g.time_label,
      type: stationType(g),
      signups: signupPeopleByGame[g.id] || [],
    }));

    payload.allPlayers = usersR.recordset
      .filter(u => u.team === 'buffalo' || u.team === 'roadhouse')
      .map(u => ({ name: formatName(u.first_name, u.last_name, u.username), team: u.team }));
  }

  return payload;
}

module.exports = {
  buildBootstrap, bustSharedBootstrap, getSettings, upsertSetting, settingsFromRows,
  stationType, slotsOverlap, signupMaxFor, SIGNUP_MAX_BUFFALO, SIGNUP_MAX_ROADHOUSE, SLOT_MINUTES,
};
