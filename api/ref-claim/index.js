const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireRef } = require('../lib/auth');
const { buildBootstrap, bustSharedBootstrap } = require('../lib/bootstrap');

// A ref adds a game to their list (claims) or drops it (releases). Since
// migration 010 the PK is (game_id, user_id): ANY number of refs can hold the
// same game, uncapped, and claiming never bumps another ref. Releasing only
// removes the caller's own row. Pre-010 (PK still game_id-only) a claim on a
// game someone else holds fails the PK — surfaced as a friendly 409.
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
        try {
          await pool.request().input('gid', sql.NVarChar, gameId).input('uid', sql.Int, user.id)
            .query(`
              IF NOT EXISTS (SELECT 1 FROM bo_ref_assignments WHERE game_id = @gid AND user_id = @uid)
                INSERT INTO bo_ref_assignments (game_id, user_id) VALUES (@gid, @uid);`);
        } catch (e) {
          // Pre-010 the PK is game_id-only, so a second ref's insert collides.
          return json({ error: 'Another ref already has this game (migration 010 enables multiple refs)' }, 409);
        }
      }

      bustSharedBootstrap();
      return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
    } catch (err) {
      context.error('ref-claim error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
