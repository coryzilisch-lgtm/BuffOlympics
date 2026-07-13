const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireAdmin } = require('../lib/auth');

app.http('ac-dip', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'ac/dip/{entryId}',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireAdmin(user)) return json({ error: 'Admin access required' }, 403);

      const entryId = parseInt(request.params.entryId, 10);
      if (!Number.isInteger(entryId)) return json({ error: 'Invalid dip entry id' }, 400);

      const pool = await getPool();
      const entryR = await pool.request()
        .input('eid', sql.Int, entryId)
        .query('SELECT id FROM bo_dip_entries WHERE id = @eid');
      if (!entryR.recordset.length) return json({ error: 'Dip entry not found' }, 404);

      await pool.request()
        .input('eid', sql.Int, entryId)
        .query(`
          DELETE FROM bo_dip_votes WHERE dip_entry_id = @eid;
          DELETE FROM bo_dip_entries WHERE id = @eid;`);

      return json({ ok: true });
    } catch (err) {
      context.error('admin-dip error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
