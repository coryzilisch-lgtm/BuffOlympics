const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap, getSettings } = require('../lib/bootstrap');

const MAX_COOKS_PER_TRIBE = 5;

app.http('dip', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dip',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);

      const body = await request.json().catch(() => ({}));
      const action = body.action;
      if (action !== 'enter' && action !== 'leave') {
        return json({ error: "action must be 'enter' or 'leave'" }, 400);
      }

      const pool = await getPool();
      const settings = await getSettings(pool);
      if (settings.eventMode !== 'signup') {
        return json({ error: 'The Dip Off roster is locked on game day' }, 409);
      }

      if (action === 'enter') {
        if (!user.team) return json({ error: 'Pick your tribe before entering the Dip Off' }, 409);

        const existsR = await pool.request()
          .input('uid', sql.Int, user.id)
          .query('SELECT 1 AS x FROM bo_dip_entries WHERE user_id = @uid');
        if (existsR.recordset.length) {
          return json({ error: "You're already entered in the Dip Off" }, 409);
        }

        const countR = await pool.request()
          .input('team', sql.NVarChar, user.team)
          .query('SELECT COUNT(*) AS n FROM bo_dip_entries WHERE team = @team');
        if (countR.recordset[0].n >= MAX_COOKS_PER_TRIBE) {
          return json({ error: `Your tribe already has ${MAX_COOKS_PER_TRIBE} cooks in the Dip Off` }, 409);
        }

        await pool.request()
          .input('uid', sql.Int, user.id)
          .input('team', sql.NVarChar, user.team)
          .query('INSERT INTO bo_dip_entries (user_id, team) VALUES (@uid, @team)');
      } else {
        // leave — drop any votes pointing at my entry, then the entry itself.
        await pool.request()
          .input('uid', sql.Int, user.id)
          .query(`
            DELETE FROM bo_dip_votes
              WHERE dip_entry_id IN (SELECT id FROM bo_dip_entries WHERE user_id = @uid);
            DELETE FROM bo_dip_entries WHERE user_id = @uid;`);
      }

      return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
    } catch (err) {
      context.error('dip error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
