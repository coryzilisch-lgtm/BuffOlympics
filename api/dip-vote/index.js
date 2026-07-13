const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap, getSettings } = require('../lib/bootstrap');

app.http('dip-vote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dip/vote',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);

      const body = await request.json().catch(() => ({}));
      const entryId = parseInt(body.entryId, 10);
      if (!Number.isInteger(entryId)) return json({ error: 'entryId is required' }, 400);

      const pool = await getPool();
      const settings = await getSettings(pool);
      if (settings.eventMode !== 'gameday') {
        return json({ error: 'Dip Off voting opens on game day' }, 409);
      }

      const entryR = await pool.request()
        .input('eid', sql.Int, entryId)
        .query('SELECT id FROM bo_dip_entries WHERE id = @eid');
      if (!entryR.recordset.length) return json({ error: 'Dip entry not found' }, 404);

      // Upsert — one vote per user, switching is allowed.
      await pool.request()
        .input('uid', sql.Int, user.id)
        .input('eid', sql.Int, entryId)
        .query(`
          IF EXISTS (SELECT 1 FROM bo_dip_votes WHERE user_id = @uid)
            UPDATE bo_dip_votes SET dip_entry_id = @eid WHERE user_id = @uid;
          ELSE
            INSERT INTO bo_dip_votes (user_id, dip_entry_id) VALUES (@uid, @eid);`);

      return json({ bootstrap: await buildBootstrap(pool, user) });
    } catch (err) {
      context.error('dip-vote error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
