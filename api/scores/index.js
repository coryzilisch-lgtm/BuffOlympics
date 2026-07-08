const { app } = require('@azure/functions');
const { getPool } = require('../lib/db');
const { json, requireUser, requireAdmin } = require('../lib/auth');
const { getSettings } = require('../lib/bootstrap');

app.http('scores', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scores',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);

      const pool = await getPool();
      const [settings, totalsR] = await Promise.all([
        getSettings(pool),
        pool.request().query(
          'SELECT ISNULL(SUM(pts_buffalo), 0) AS buffalo, ISNULL(SUM(pts_roadhouse), 0) AS roadhouse FROM bo_results'),
      ]);
      const totals = totalsR.recordset[0] || { buffalo: 0, roadhouse: 0 };

      if (settings.scoresRevealed) {
        return json({ revealed: true, buffalo: totals.buffalo, roadhouse: totals.roadhouse });
      }
      if (requireAdmin(user) && request.query.get('peek') === '1') {
        return json({ revealed: false, peek: true, buffalo: totals.buffalo, roadhouse: totals.roadhouse });
      }
      return json({ revealed: false });
    } catch (err) {
      context.error('scores error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
