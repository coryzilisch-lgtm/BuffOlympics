const { app } = require('@azure/functions');
const { getPool } = require('../lib/db');
const { json, requireUser, requireAdmin, formatName } = require('../lib/auth');
const { settingsFromRows } = require('../lib/bootstrap');
const { blockLabel } = require('../lib/blocks');

// Flat route 'admin-board' — deliberately NOT under the 'admin/…' segment
// space, because a two-segment 'admin/overview' collides with admin-actions'
// 'admin/{action}' template (the host drops one, 404-ing the GET). It's also
// a FRESH function name (was 'admin-overview'): SWA wedges a function name to
// 404 once it deploys with a conflicting route, and only a full rename
// (folder + name + route) forces re-registration.
app.http('admin-board', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin-board',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireAdmin(user)) return json({ error: 'Admin access required' }, 403);

      const pool = await getPool();
      const [
        settingsR, usersR, gamesR, signupsR, scheduleR, dipR, votesR,
        legsR, relayR, scoresR, resultsR, historyR, refAssignR, annR,
      ] = await Promise.all([
        pool.request().query('SELECT [key], [value] FROM bo_settings'),
        pool.request().query('SELECT id, first_name, last_name, username, team, is_ref, is_admin FROM bo_users ORDER BY id'),
        pool.request().query(`
          SELECT id, name, block, cap, players, time_label, points_label, needs_ref, venue, open_play
          FROM bo_games ORDER BY sort, id`),
        pool.request().query('SELECT user_id, game_id FROM bo_signups'),
        pool.request().query('SELECT id, time_label, ampm, title, place, kind FROM bo_schedule ORDER BY sort, id'),
        pool.request().query(`
          SELECT d.id, d.user_id, d.team, d.created_at, u.first_name, u.last_name, u.username
          FROM bo_dip_entries d JOIN bo_users u ON u.id = d.user_id
          ORDER BY d.created_at, d.id`),
        pool.request().query('SELECT dip_entry_id, COUNT(*) AS n FROM bo_dip_votes GROUP BY dip_entry_id'),
        pool.request().query('SELECT id, name, cap, descr FROM bo_relay_legs ORDER BY sort, id'),
        pool.request().query(`
          SELECT r.leg_id, r.user_id, u.team, u.first_name, u.last_name, u.username
          FROM bo_relay_signups r JOIN bo_users u ON u.id = r.user_id`),
        pool.request().query('SELECT ISNULL(SUM(pts_buffalo), 0) AS buffalo, ISNULL(SUM(pts_roadhouse), 0) AS roadhouse FROM bo_results'),
        pool.request().query(`
          SELECT id, game_name, detail, winner, pts, player_name, entered_by, edited_by, created_at
          FROM bo_results ORDER BY created_at DESC, id DESC`),
        pool.request().query('SELECT id, result_id, pts, by_name, created_at FROM bo_result_history ORDER BY created_at DESC, id DESC'),
        pool.request().query('SELECT game_id, user_id FROM bo_ref_assignments'),
        pool.request().query('SELECT id, title, body, created_at FROM bo_announcements ORDER BY created_at DESC, id DESC'),
      ]);

      const settings = settingsFromRows(settingsR.recordset);

      const gameById = {};
      for (const g of gamesR.recordset) gameById[g.id] = g;

      const gamesByUser = {};
      for (const s of signupsR.recordset) {
        if (!gamesByUser[s.user_id]) gamesByUser[s.user_id] = [];
        const g = gameById[s.game_id];
        gamesByUser[s.user_id].push({ gameId: s.game_id, name: g ? g.name : s.game_id });
      }

      const people = usersR.recordset.map(u => ({
        id: u.id,
        name: formatName(u.first_name, u.last_name, u.username),
        team: u.team || null,
        isAdmin: !!u.is_admin,
        isRef: !!u.is_ref,
        games: gamesByUser[u.id] || [],
      }));

      const gamesCatalog = gamesR.recordset.map(g => ({
        id: g.id,
        name: g.name,
        block: g.block,
        blockLabel: blockLabel(g.block),
        players: g.players,
        pointsLabel: g.points_label,
        needsRef: !!g.needs_ref,
        venue: g.venue,
      }));

      const schedule = scheduleR.recordset.map(r => ({
        id: r.id, timeLabel: r.time_label, ampm: r.ampm, title: r.title, place: r.place, kind: r.kind,
      }));

      // ── dip (admins see all names + vote counts) ──
      const votesByEntry = {};
      let totalVotes = 0;
      for (const v of votesR.recordset) {
        votesByEntry[v.dip_entry_id] = v.n;
        totalVotes += v.n;
      }
      // `no` is the GLOBAL dip number (order of entry across both tribes) —
      // must match the numbering voters see on the anonymous ballot.
      const dipCounts = { buffalo: 0, roadhouse: 0 };
      const dipEntries = dipR.recordset.map((d, i) => {
        const team = d.team === 'roadhouse' ? 'roadhouse' : 'buffalo';
        dipCounts[team] += 1;
        return {
          id: d.id,
          no: i + 1,
          name: formatName(d.first_name, d.last_name, d.username),
          team,
          votes: votesByEntry[d.id] || 0,
        };
      });

      // ── relay ──
      const legs = legsR.recordset.map(l => ({ id: l.id, name: l.name, cap: l.cap, desc: l.descr }));
      const relayRoster = {};
      for (const l of legs) relayRoster[l.id] = { buffalo: [], roadhouse: [] };
      for (const r of relayR.recordset) {
        if (!relayRoster[r.leg_id]) relayRoster[r.leg_id] = { buffalo: [], roadhouse: [] };
        if (r.team === 'buffalo' || r.team === 'roadhouse') {
          relayRoster[r.leg_id][r.team].push(formatName(r.first_name, r.last_name, r.username));
        }
      }

      // ── results with edit history ──
      const historyByResult = {};
      for (const h of historyR.recordset) {
        if (!historyByResult[h.result_id]) historyByResult[h.result_id] = [];
        historyByResult[h.result_id].push({
          pts: h.pts,
          by: h.by_name,
          when: h.created_at ? new Date(h.created_at).toISOString() : null,
        });
      }
      const results = resultsR.recordset.map(r => ({
        id: r.id,
        game: r.game_name,
        detail: r.detail,
        pts: r.pts,
        winner: r.winner,
        enteredBy: r.entered_by,
        editedBy: r.edited_by || null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        history: historyByResult[r.id] || [],
      }));

      const refAssignments = {};
      for (const a of refAssignR.recordset) refAssignments[a.game_id] = a.user_id;

      const refs = usersR.recordset
        .filter(u => u.is_ref)
        .map(u => ({ id: u.id, name: formatName(u.first_name, u.last_name, u.username) }));

      const totals = scoresR.recordset[0] || { buffalo: 0, roadhouse: 0 };

      return json({
        stats: {
          people: usersR.recordset.length,
          games: gamesR.recordset.length,
          refs: refs.length,
          admins: usersR.recordset.filter(u => u.is_admin).length,
        },
        people,
        gamesCatalog,
        schedule,
        dip: { entries: dipEntries, counts: dipCounts, totalVotes, revealed: settings.dipRevealed },
        relay: { legs, roster: relayRoster, total: relayR.recordset.length },
        scores: { buffalo: totals.buffalo, roadhouse: totals.roadhouse, revealed: settings.scoresRevealed },
        results,
        refAssignments,
        refs,
        settings: {
          eventMode: settings.eventMode,
          refJoinCode: settings.refJoinCode,
          scoresRevealed: settings.scoresRevealed,
          dipRevealed: settings.dipRevealed,
        },
        announcements: annR.recordset.map(a => ({
          id: a.id, title: a.title, body: a.body,
          createdAt: a.created_at ? new Date(a.created_at).toISOString() : null,
        })),
      });
    } catch (err) {
      context.error('admin-board error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
