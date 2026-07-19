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

        // ATOMIC per-tribe cap — recount under a range lock so two simultaneous
        // "enter" taps can't both see 4 < 5 and make 6 cooks.
        const ins = await pool.request()
          .input('uid', sql.Int, user.id)
          .input('team', sql.NVarChar, user.team)
          .input('cap', sql.Int, MAX_COOKS_PER_TRIBE)
          .query(`
            SET NOCOUNT ON;
            SET XACT_ABORT ON;
            BEGIN TRANSACTION;
              DECLARE @n INT = (
                SELECT COUNT(*) FROM bo_dip_entries WITH (UPDLOCK, HOLDLOCK) WHERE team = @team
              );
              DECLARE @inserted INT = 0;
              IF @n < @cap AND NOT EXISTS (SELECT 1 FROM bo_dip_entries WHERE user_id = @uid)
              BEGIN
                INSERT INTO bo_dip_entries (user_id, team) VALUES (@uid, @team);
                SET @inserted = 1;
              END
            COMMIT TRANSACTION;
            SELECT @inserted AS inserted;`);
        const dipSets = ins.recordsets && ins.recordsets.length ? ins.recordsets[ins.recordsets.length - 1] : ins.recordset;
        if (!((dipSets && dipSets[0]) || {}).inserted) {
          return json({ error: `Your tribe already has ${MAX_COOKS_PER_TRIBE} cooks in the Dip Off` }, 409);
        }
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
