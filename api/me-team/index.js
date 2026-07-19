const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, userToJson } = require('../lib/auth');
const { bustSharedBootstrap } = require('../lib/bootstrap');

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
      // Switching tribes after committing breaks caps and rosters (a Buffalo
      // player with 4 slots becomes a TXRH player over the 2-slot cap, and
      // every roster recolors) — so a CHANGE is only allowed while the user has
      // no sign-ups. First-time picks always go through.
      if (user.team && user.team !== team) {
        const busyR = await pool.request().input('uid', sql.Int, user.id).query(`
          SELECT (SELECT COUNT(*) FROM bo_signups WHERE user_id = @uid)
               + (SELECT COUNT(*) FROM bo_dip_entries WHERE user_id = @uid)
               + (SELECT COUNT(*) FROM bo_relay_signups WHERE user_id = @uid) AS n`);
        if (busyR.recordset[0].n > 0) {
          return json({ error: 'You have sign-ups on your current tribe — ask an admin to move you' }, 409);
        }
      }
      await pool.request()
        .input('id', sql.Int, user.id)
        .input('team', sql.NVarChar, team)
        .query('UPDATE bo_users SET team = @team WHERE id = @id');
      user.team = team;
      bustSharedBootstrap();  // tribes + slot rosters change with a team switch

      return json({ user: userToJson(user) });
    } catch (err) {
      context.error('me-team error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
