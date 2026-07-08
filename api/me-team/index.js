const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, userToJson } = require('../lib/auth');

app.http('me-team', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'me/team',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);

      const body = await request.json().catch(() => ({}));
      const team = body.team;
      if (team !== 'buffalo' && team !== 'roadhouse') {
        return json({ error: 'Pick a tribe — buffalo or roadhouse' }, 400);
      }

      const pool = await getPool();
      await pool.request()
        .input('id', sql.Int, user.id)
        .input('team', sql.NVarChar, team)
        .query('UPDATE bo_users SET team = @team WHERE id = @id');
      user.team = team;

      return json({ user: userToJson(user) });
    } catch (err) {
      context.error('me-team error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
