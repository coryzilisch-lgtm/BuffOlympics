const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap, getSettings } = require('../lib/bootstrap');

app.http('relay', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'relay',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      const pool = await getPool();

      if (request.method === 'DELETE') {
        // Leaving is a sign-up-phase action too — on game day the roster is
        // locked BOTH ways (a leave can't be undone once joins are locked).
        const delSettings = await getSettings(pool);
        if (delSettings.eventMode !== 'signup') {
          return json({ error: 'The relay roster is locked on game day' }, 409);
        }
        await pool.request()
          .input('uid', sql.Int, user.id)
          .query('DELETE FROM bo_relay_signups WHERE user_id = @uid');
        return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
      }

      // POST — join a leg (switching removes me from any other leg).
      const body = await request.json().catch(() => ({}));
      const legId = body.legId;
      if (!legId) return json({ error: 'legId is required' }, 400);
      if (!user.team) return json({ error: 'Pick your tribe before joining the relay' }, 409);

      const settings = await getSettings(pool);
      if (settings.eventMode !== 'signup') {
        return json({ error: 'Relay signups are locked on game day' }, 409);
      }

      const legR = await pool.request()
        .input('lid', sql.NVarChar, legId)
        .query('SELECT id, name, cap FROM bo_relay_legs WHERE id = @lid');
      const leg = legR.recordset[0];
      if (!leg) return json({ error: 'Relay leg not found' }, 404);

      const mineR = await pool.request()
        .input('uid', sql.Int, user.id)
        .query('SELECT leg_id FROM bo_relay_signups WHERE user_id = @uid');
      const currentLeg = mineR.recordset.length ? mineR.recordset[0].leg_id : null;
      if (currentLeg === leg.id) {
        // Already in this leg — no-op.
        return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
      }

      // ATOMIC capacity guard — same discipline as game-slot sign-ups: lock the
      // leg row, recount under the lock, insert only if there's room. A plain
      // count-then-insert lets two simultaneous joins both see cap-1 and both
      // land (oversold leg).
      const ins = await pool.request()
        .input('uid', sql.Int, user.id)
        .input('lid', sql.NVarChar, leg.id)
        .input('team', sql.NVarChar, user.team)
        .input('cap', sql.Int, leg.cap)
        .query(`
          SET NOCOUNT ON;
          SET XACT_ABORT ON;
          BEGIN TRANSACTION;
            -- Assignment SELECT — a bare SELECT would emit result set #1 and
            -- .recordset would read the lock row instead of the inserted flag.
            DECLARE @lockId NVARCHAR(10);
            SELECT @lockId = id FROM bo_relay_legs WITH (UPDLOCK, HOLDLOCK) WHERE id = @lid;
            DECLARE @n INT = (
              SELECT COUNT(*) FROM bo_relay_signups r JOIN bo_users u ON u.id = r.user_id
              WHERE r.leg_id = @lid AND u.team = @team AND r.user_id <> @uid
            );
            DECLARE @inserted INT = 0;
            IF @n < @cap
            BEGIN
              DELETE FROM bo_relay_signups WHERE user_id = @uid;
              INSERT INTO bo_relay_signups (user_id, leg_id) VALUES (@uid, @lid);
              SET @inserted = 1;
            END
          COMMIT TRANSACTION;
          SELECT @inserted AS inserted;`);
      const legSets = ins.recordsets && ins.recordsets.length ? ins.recordsets[ins.recordsets.length - 1] : ins.recordset;
      if (!((legSets && legSets[0]) || {}).inserted) {
        return json({ error: `${leg.name} is full for your tribe` }, 409);
      }

      return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
    } catch (err) {
      context.error('relay error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
