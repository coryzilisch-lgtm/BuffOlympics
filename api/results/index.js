const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireRef, formatName } = require('../lib/auth');
const { bustSharedBootstrap } = require('../lib/bootstrap');

const TEAMS = ['buffalo', 'roadhouse'];

function toScore(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function insertResult(pool, row) {
  await pool.request()
    .input('game_name', sql.NVarChar, row.gameName)
    .input('detail', sql.NVarChar, row.detail)
    .input('winner', sql.NVarChar, row.winner)
    .input('pts', sql.Int, row.pts)
    .input('pts_buffalo', sql.Int, row.ptsBuffalo)
    .input('pts_roadhouse', sql.Int, row.ptsRoadhouse)
    .input('player_name', sql.NVarChar, row.playerName || null)
    .input('entered_by', sql.NVarChar, row.enteredBy)
    .input('entered_by_id', sql.Int, row.enteredById)
    .query(`
      INSERT INTO bo_results
        (game_name, detail, winner, pts, pts_buffalo, pts_roadhouse,
         player_name, entered_by, entered_by_id)
      VALUES
        (@game_name, @detail, @winner, @pts, @pts_buffalo, @pts_roadhouse,
         @player_name, @entered_by, @entered_by_id);
    `);
}

app.http('results', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'results',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireRef(user)) return json({ error: 'Referee or admin access required' }, 403);

      const body = await request.json().catch(() => ({}));
      const gameName = String(body.gameName || '').trim();
      if (!gameName) return json({ error: 'gameName is required' }, 400);

      const pool = await getPool();
      const enteredBy = formatName(user.first_name, user.last_name, user.username);
      const enteredById = user.id;

      if (body.type === 'vs') {
        const b = toScore(body.ptsBuffalo);
        const r = toScore(body.ptsRoadhouse);
        if (!b && !r) return json({ error: 'Enter a score for at least one tribe' }, 400);
        await insertResult(pool, {
          gameName,
          detail: `Buffalo ${b} – ${r} Roadhouse`,
          winner: b >= r ? 'buffalo' : 'roadhouse',
          pts: Math.max(b, r),
          ptsBuffalo: b,
          ptsRoadhouse: r,
          playerName: null,
          enteredBy, enteredById,
        });
        bustSharedBootstrap();
        return json({ ok: true });
      }

      if (body.type === 'solo') {
        const entries = Array.isArray(body.entries) ? body.entries : [];
        const scored = entries
          .map(e => ({ name: String(e.name || '').trim(), team: e.team, score: toScore(e.score) }))
          .filter(e => e.name && TEAMS.includes(e.team) && e.score > 0);
        if (!scored.length) return json({ error: 'No scores to record' }, 400);
        for (const e of scored) {
          await insertResult(pool, {
            gameName,
            detail: `${e.name} scored ${e.score}`,
            winner: e.team,
            pts: e.score,
            ptsBuffalo: e.team === 'buffalo' ? e.score : 0,
            ptsRoadhouse: e.team === 'roadhouse' ? e.score : 0,
            playerName: e.name,
            enteredBy, enteredById,
          });
        }
        bustSharedBootstrap();
        return json({ ok: true });
      }

      if (body.type === 'walk') {
        const playerName = String(body.playerName || '').trim();
        const team = body.team;
        const score = toScore(body.score);
        if (!playerName) return json({ error: 'playerName is required' }, 400);
        if (!TEAMS.includes(team)) return json({ error: 'team must be buffalo or roadhouse' }, 400);
        if (score <= 0) return json({ error: 'Enter a score above zero' }, 400);
        await insertResult(pool, {
          gameName,
          detail: `${playerName} scored ${score}`,
          winner: team,
          pts: score,
          ptsBuffalo: team === 'buffalo' ? score : 0,
          ptsRoadhouse: team === 'roadhouse' ? score : 0,
          playerName,
          enteredBy, enteredById,
        });
        bustSharedBootstrap();
        return json({ ok: true });
      }

      return json({ error: "type must be 'vs', 'solo', or 'walk'" }, 400);
    } catch (err) {
      context.error('results error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
