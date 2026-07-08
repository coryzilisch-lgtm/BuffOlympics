const { sql } = require('./db');
const { BLOCKS, blockById } = require('./blocks');
const { formatName, userToJson, requireRef } = require('./auth');

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

// Ref-station type: walk-up for open play, head-to-head for small refereed
// games, solo (per-player scores) otherwise.
function stationType(g) {
  if (g.open_play) return 'walk';
  if (g.needs_ref && g.cap <= 2) return 'vs';
  return 'solo';
}

// ── the full bootstrap payload ─────────────────────────────────────────────
// Used by GET /api/bootstrap AND returned (wrapped as { bootstrap }) by every
// mutation endpoint per the contract.

async function buildBootstrap(pool, user) {
  const uid = user.id;
  const myName = formatName(user.first_name, user.last_name, user.username);

  const [
    settingsR, gamesR, signupsR, scheduleR, usersR, dipR, myVoteR,
    legsR, relayR, annR, myResultsR, scoresR, refAssignR,
  ] = await Promise.all([
    pool.request().query('SELECT [key], [value] FROM bo_settings'),
    pool.request().query(`
      SELECT id, name, block, cap, players, time_label, points_label,
             needs_ref, venue, descr, inventory, video_url, open_play
      FROM bo_games ORDER BY sort, id`),
    pool.request().query(`
      SELECT s.game_id, s.user_id, u.team, u.first_name, u.last_name, u.username
      FROM bo_signups s JOIN bo_users u ON u.id = s.user_id`),
    pool.request().query('SELECT id, time_label, ampm, title, place, kind FROM bo_schedule ORDER BY sort, id'),
    pool.request().query('SELECT id, first_name, last_name, username, team, is_ref, is_admin FROM bo_users'),
    pool.request().query(`
      SELECT d.id, d.user_id, d.team, d.created_at, u.first_name, u.last_name, u.username
      FROM bo_dip_entries d JOIN bo_users u ON u.id = d.user_id
      ORDER BY d.created_at, d.id`),
    pool.request().input('uid', sql.Int, uid)
      .query('SELECT dip_entry_id FROM bo_dip_votes WHERE user_id = @uid'),
    pool.request().query('SELECT id, name, cap, descr FROM bo_relay_legs ORDER BY sort, id'),
    pool.request().query(`
      SELECT r.leg_id, r.user_id, u.team, u.first_name, u.last_name, u.username
      FROM bo_relay_signups r JOIN bo_users u ON u.id = r.user_id`),
    pool.request().query('SELECT TOP 20 id, title, body, created_at FROM bo_announcements ORDER BY created_at DESC, id DESC'),
    pool.request().input('pname', sql.NVarChar, myName)
      .query('SELECT game_name, detail, pts FROM bo_results WHERE player_name = @pname ORDER BY created_at DESC, id DESC'),
    pool.request().query('SELECT ISNULL(SUM(pts_buffalo), 0) AS buffalo, ISNULL(SUM(pts_roadhouse), 0) AS roadhouse FROM bo_results'),
    pool.request().query('SELECT game_id, user_id FROM bo_ref_assignments'),
  ]);

  const settings = settingsFromRows(settingsR.recordset);

  // ── games + rosters ──
  const rosterByGame = {};   // gameId -> { buffalo:[names], roadhouse:[names] }
  const signupPeople = {};   // gameId -> [{ name, team }]  (for ref stations)
  const myGameIds = new Set();
  for (const s of signupsR.recordset) {
    const name = formatName(s.first_name, s.last_name, s.username);
    if (!rosterByGame[s.game_id]) rosterByGame[s.game_id] = { buffalo: [], roadhouse: [] };
    if (s.team === 'buffalo' || s.team === 'roadhouse') rosterByGame[s.game_id][s.team].push(name);
    if (!signupPeople[s.game_id]) signupPeople[s.game_id] = [];
    signupPeople[s.game_id].push({ name, team: s.team || null });
    if (s.user_id === uid) myGameIds.add(s.game_id);
  }

  const games = gamesR.recordset.map(g => ({
    id: g.id,
    name: g.name,
    block: g.block,
    cap: g.cap,
    players: g.players,
    timeLabel: g.time_label,
    pointsLabel: g.points_label,
    needsRef: !!g.needs_ref,
    venue: g.venue,
    desc: g.descr,
    inventory: g.inventory,
    videoUrl: g.video_url || null,
    openPlay: !!g.open_play,
    roster: rosterByGame[g.id] || { buffalo: [], roadhouse: [] },
    mine: myGameIds.has(g.id),
  }));

  const gameById = {};
  for (const g of gamesR.recordset) gameById[g.id] = g;

  const mySignups = [...myGameIds].map(gid => {
    const g = gameById[gid];
    const bl = g ? blockById(g.block) : null;
    return { gameId: gid, game: g ? g.name : gid, slotLabel: bl ? bl.time : '' };
  });

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
      role: u.is_admin ? 'Captain' : u.is_ref ? 'SUP Ref' : '',
    });
  }

  // ── dip off ──
  // `no` is the stable per-tribe cook number (order of entry). Names are
  // shown only for the viewer's own tribe — cooks are anonymous to the
  // other tribe / voters.
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
      no: dipCounts[team],
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

  const payload = {
    user: userToJson(user),
    settings: {
      eventMode: settings.eventMode,
      scoresRevealed: settings.scoresRevealed,
      dipRevealed: settings.dipRevealed,
    },
    serverTime: new Date().toISOString(),
    games,
    blocks: BLOCKS,
    mySignups,
    schedule,
    tribes,
    dip: { counts: dipCounts, entries: dipEntries, myEntry, myVote },
    relay: { legs, roster: relayRoster, myLeg },
    announcements,
    myResults,
    scores,
  };

  // ── refs/admins only ──
  if (requireRef(user)) {
    const assignments = {};
    for (const a of refAssignR.recordset) assignments[a.game_id] = a.user_id;

    // My assigned games + every open-play game (walk-up stations are
    // shared). Admins get all needs_ref games as stations.
    const stations = gamesR.recordset.filter(g =>
      g.open_play || (user.is_admin ? g.needs_ref : assignments[g.id] === uid));

    payload.refStations = stations.map(g => ({
      gameId: g.id,
      name: g.name,
      venue: g.venue,
      timeLabel: g.time_label,
      type: stationType(g),
      signups: signupPeople[g.id] || [],
    }));

    payload.allPlayers = usersR.recordset
      .filter(u => u.team === 'buffalo' || u.team === 'roadhouse')
      .map(u => ({ name: formatName(u.first_name, u.last_name, u.username), team: u.team }));
  }

  return payload;
}

module.exports = { buildBootstrap, getSettings, upsertSetting, settingsFromRows, stationType };
