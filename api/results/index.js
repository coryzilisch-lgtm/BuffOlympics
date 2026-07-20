const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireRef, formatName } = require('../lib/auth');
const { bustResultsBootstrap } = require('../lib/bootstrap');

const TEAMS = ['buffalo', 'roadhouse'];

function toScore(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function insertResult(pool, row) {
  const base = (req) => req
    .input('game_name', sql.NVarChar, row.gameName)
    .input('detail', sql.NVarChar, row.detail)
    .input('winner', sql.NVarChar, row.winner)
    .input('pts', sql.Int, row.pts)
    .input('pts_buffalo', sql.Int, row.ptsBuffalo)
    .input('pts_roadhouse', sql.Int, row.ptsRoadhouse)
    .input('player_name', sql.NVarChar, row.playerName || null)
    .input('entered_by', sql.NVarChar, row.enteredBy)
    .input('entered_by_id', sql.Int, row.enteredById);
  try {
    // slot_id (migration 012) pins the result to ONE slot even when two slots
    // share a time label (two 1:30 bracket matches); slot_label / round_label
    // (migration 010) drive the "Scored" marks and round displays.
    await base(pool.request())
      .input('slot_label', sql.NVarChar, row.slotLabel || null)
      .input('round_label', sql.NVarChar, row.roundLabel || null)
      .input('slot_id', sql.Int, row.slotId || null)
      .query(`
        INSERT INTO bo_results
          (game_name, detail, winner, pts, pts_buffalo, pts_roadhouse,
           player_name, entered_by, entered_by_id, slot_label, round_label, slot_id)
        VALUES
          (@game_name, @detail, @winner, @pts, @pts_buffalo, @pts_roadhouse,
           @player_name, @entered_by, @entered_by_id, @slot_label, @round_label, @slot_id);
      `);
  } catch (e0) {
    // The fallbacks exist ONLY for pre-migration schemas (missing column =
    // SQL error 207). Any other failure (timeout, deadlock, connection blip)
    // must surface — falling through would silently strip the slot/label tags,
    // or even double-insert if the first INSERT actually committed.
    if (!e0 || e0.number !== 207) throw e0;
    try {
      // Pre-012 (slot_id missing) — store with the 010 label tags only.
      await base(pool.request())
        .input('slot_label', sql.NVarChar, row.slotLabel || null)
        .input('round_label', sql.NVarChar, row.roundLabel || null)
        .query(`
          INSERT INTO bo_results
            (game_name, detail, winner, pts, pts_buffalo, pts_roadhouse,
             player_name, entered_by, entered_by_id, slot_label, round_label)
          VALUES
            (@game_name, @detail, @winner, @pts, @pts_buffalo, @pts_roadhouse,
             @player_name, @entered_by, @entered_by_id, @slot_label, @round_label);
        `);
    } catch (e) {
      if (!e || e.number !== 207) throw e;
      // Pre-010 (columns missing) — store the row without the tags.
      await base(pool.request()).query(`
        INSERT INTO bo_results
          (game_name, detail, winner, pts, pts_buffalo, pts_roadhouse,
           player_name, entered_by, entered_by_id)
        VALUES
          (@game_name, @detail, @winner, @pts, @pts_buffalo, @pts_roadhouse,
           @player_name, @entered_by, @entered_by_id);
      `);
    }
  }
}

function labelsFrom(body) {
  const sid = parseInt(body.slotId, 10);
  return {
    slotLabel: String(body.slotLabel || '').trim().slice(0, 80) || null,
    roundLabel: String(body.roundLabel || '').trim().slice(0, 120) || null,
    slotId: Number.isInteger(sid) && sid > 0 ? sid : null,
  };
}

app.http('results', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'results/{id?}',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireRef(user)) return json({ error: 'Referee or admin access required' }, 403);

      // DELETE /api/results/{id} — a ref removes a logged result (and its edit
      // history) so it can be re-entered. Powers the "Change result" flow; the
      // frontend warns before calling this.
      if (request.method === 'DELETE') {
        const id = parseInt(request.params.id, 10);
        if (!Number.isInteger(id)) return json({ error: 'A result id is required' }, 400);
        const pool0 = await getPool();
        await pool0.request().input('id', sql.Int, id)
          .query('DELETE FROM bo_result_history WHERE result_id = @id');
        const dr = await pool0.request().input('id', sql.Int, id)
          .query('DELETE FROM bo_results WHERE id = @id');
        if (!dr.rowsAffected[0]) return json({ error: 'That result is already gone' }, 404);
        bustResultsBootstrap();
        return json({ ok: true });
      }

      const body = await request.json().catch(() => ({}));
      const gameName = String(body.gameName || '').trim();
      if (!gameName) return json({ error: 'gameName is required' }, 400);

      const pool = await getPool();
      const enteredBy = formatName(user.first_name, user.last_name, user.username);
      const enteredById = user.id;

      if (body.type === 'vs') {
        // Variable-score team slot — the ref types one score per team.
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
          ...labelsFrom(body),
        });
        bustResultsBootstrap();
        return json({ ok: true });
      }

      // Ref picks the winning TEAM of a head-to-head / bracket match. Points
      // are server-authoritative from the game row: `stage:'round'` (within-
      // tribe bracket round) awards round_points (migration 010; NULL/0 =
      // advancement only, the old behavior); otherwise `scores:true` awards
      // win_points (championship / plain head-to-head).
      if (body.type === 'winner') {
        const winnerTeam = body.winnerTeam;
        if (!TEAMS.includes(winnerTeam)) return json({ error: 'winnerTeam must be buffalo or roadhouse' }, 400);
        const winnerName = String(body.winnerName || '').trim()
          || (winnerTeam === 'buffalo' ? 'Buffalo' : 'Texas Roadhouse');
        const isRound = body.stage === 'round';
        // Points are looked up by game ID when the client sends one (names are
        // NOT unique and can be edited); the name lookup is only a fallback
        // for older clients.
        const gameId = String(body.gameId || '').trim();
        const ptsCol = async (col, dflt) => {
          try {
            let pr;
            if (gameId) {
              pr = await pool.request().input('gid', sql.NVarChar, gameId)
                .query(`SELECT TOP 1 ${col} AS v FROM bo_games WHERE id = @gid`);
            }
            if (!pr || !pr.recordset.length) {
              pr = await pool.request().input('n', sql.NVarChar, gameName)
                .query(`SELECT TOP 1 ${col} AS v FROM bo_games WHERE name = @n`);
            }
            return pr.recordset.length && pr.recordset[0].v != null ? pr.recordset[0].v : dflt;
          } catch (e) { return dflt; /* pre-migration column */ }
        };
        let pts = 0;
        if (isRound) {
          pts = await ptsCol('round_points', 0);
        } else if (body.scores) {
          pts = await ptsCol('win_points', 10);
        }
        const detail = isRound
          ? (pts > 0 ? `${winnerName} won the round (+${pts}) — advances` : `${winnerName} won — advances`)
          : `${winnerName} won (+${pts})`;
        await insertResult(pool, {
          gameName,
          detail,
          winner: winnerTeam,
          pts,
          ptsBuffalo: winnerTeam === 'buffalo' ? pts : 0,
          ptsRoadhouse: winnerTeam === 'roadhouse' ? pts : 0,
          playerName: winnerName,
          enteredBy, enteredById,
          ...labelsFrom(body),
        });
        bustResultsBootstrap();
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
            ...labelsFrom(body),
          });
        }
        bustResultsBootstrap();
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
        bustResultsBootstrap();
        return json({ ok: true });
      }

      return json({ error: "type must be 'winner', 'vs', 'solo', or 'walk'" }, 400);
    } catch (err) {
      context.error('results error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
