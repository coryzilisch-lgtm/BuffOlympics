const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireAdmin, formatName } = require('../lib/auth');
const { bustSharedBootstrap } = require('../lib/bootstrap');

app.http('ac-results', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'ac/results/{id}',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireAdmin(user)) return json({ error: 'Admin access required' }, 403);

      const id = parseInt(request.params.id, 10);
      if (!Number.isInteger(id)) return json({ error: 'Invalid result id' }, 400);

      const body = await request.json().catch(() => ({}));
      const pts = parseInt(body.pts, 10);
      if (!Number.isInteger(pts) || pts < 0) return json({ error: 'pts must be a non-negative number' }, 400);

      const pool = await getPool();
      const rowR = await pool.request()
        .input('id', sql.Int, id)
        .query('SELECT id, pts, winner, entered_by, edited_by FROM bo_results WHERE id = @id');
      const row = rowR.recordset[0];
      if (!row) return json({ error: 'Result not found' }, 404);

      // Push the previous value into the edit history first.
      await pool.request()
        .input('result_id', sql.Int, row.id)
        .input('pts', sql.Int, row.pts)
        .input('by_name', sql.NVarChar, row.edited_by || row.entered_by)
        .query('INSERT INTO bo_result_history (result_id, pts, by_name) VALUES (@result_id, @pts, @by_name)');

      // Update pts and recompute the winning side's team contribution.
      const editorName = formatName(user.first_name, user.last_name, user.username);
      await pool.request()
        .input('id', sql.Int, row.id)
        .input('pts', sql.Int, pts)
        .input('edited_by', sql.NVarChar, editorName)
        .query(`
          UPDATE bo_results SET
            pts = @pts,
            pts_buffalo = CASE WHEN winner = 'buffalo' THEN @pts ELSE pts_buffalo END,
            pts_roadhouse = CASE WHEN winner = 'roadhouse' THEN @pts ELSE pts_roadhouse END,
            edited_by = @edited_by,
            updated_at = SYSUTCDATETIME()
          WHERE id = @id`);

      // Totals + leaderboard live in the shared cache — a pts edit right before
      // the reveal must not serve stale scores for up to 45s.
      bustSharedBootstrap();
      return json({ ok: true });
    } catch (err) {
      context.error('admin-results error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
