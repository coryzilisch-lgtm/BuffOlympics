const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireRef } = require('../lib/auth');
const { buildBootstrap, bustSharedBootstrap } = require('../lib/bootstrap');

// A ref self-assigns (claims) or releases a game. bo_ref_assignments is
// one-ref-per-game (PK game_id), so claiming takes the game over from whoever
// held it — that's how refs move coverage around. Releasing only clears it if
// it's currently theirs.
app.http('ref-claim', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ref-claim',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireRef(user)) return json({ error: 'Referee access required' }, 403);

      const body = await request.json().catch(() => ({}));
      const gameId = String(body.gameId || '').trim();
      if (!gameId) return json({ error: 'gameId is required' }, 400);

      const pool = await getPool();
      const gR = await pool.request().input('gid', sql.NVarChar, gameId)
        .query('SELECT id FROM bo_games WHERE id = @gid');
      if (!gR.recordset.length) return json({ error: 'Game not found' }, 404);

      if (body.claim === false) {
        await pool.request().input('gid', sql.NVarChar, gameId).input('uid', sql.Int, user.id)
          .query('DELETE FROM bo_ref_assignments WHERE game_id = @gid AND user_id = @uid');
      } else {
        await pool.request().input('gid', sql.NVarChar, gameId).input('uid', sql.Int, user.id)
          .query(`
            IF EXISTS (SELECT 1 FROM bo_ref_assignments WHERE game_id = @gid)
              UPDATE bo_ref_assignments SET user_id = @uid WHERE game_id = @gid;
            ELSE
              INSERT INTO bo_ref_assignments (game_id, user_id) VALUES (@gid, @uid);`);
      }

      bustSharedBootstrap();
      return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
    } catch (err) {
      context.error('ref-claim error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
