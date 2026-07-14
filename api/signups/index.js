const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap, getSettings, slotsOverlap, signupMaxFor } = require('../lib/bootstrap');

// Sign up for a SLOT (a specific 5-minute time within a game). Enforces, all
// server-side: signup phase only, slot exists, my tribe has room in that slot,
// the per-tribe day cap (Buffalo 4 / TXRH 2), and no two of my slots overlap in
// time — EXCEPT walk-up (open_play) games, which may overlap (the UI warns to
// finish inside the window, then the game reverts to free walk-up).
async function handleSignup(pool, user, slotId) {
  const sid = parseInt(slotId, 10);
  if (!Number.isInteger(sid)) return json({ error: 'slotId is required' }, 400);
  if (!user.team) return json({ error: 'Pick your tribe before signing up' }, 409);
  const team = user.team === 'roadhouse' ? 'roadhouse' : 'buffalo';

  const settings = await getSettings(pool);
  if (settings.eventMode !== 'signup') {
    return json({ error: "Signups are locked — it's game day!" }, 409);
  }

  const slotR = await pool.request()
    .input('sid', sql.Int, sid)
    .query(`
      SELECT sl.id, sl.game_id, sl.start_min, sl.label, sl.cap_buffalo, sl.cap_roadhouse, g.name, g.open_play
      FROM bo_game_slots sl JOIN bo_games g ON g.id = sl.game_id
      WHERE sl.id = @sid`);
  const slot = slotR.recordset[0];
  if (!slot) return json({ error: 'That time slot no longer exists' }, 404);

  const teamCap = team === 'buffalo' ? slot.cap_buffalo : slot.cap_roadhouse;
  if (teamCap <= 0) {
    return json({ error: `${slot.name} at ${slot.label} isn't open to your tribe` }, 409);
  }

  // My current slots (for cap + overlap checks).
  const mineR = await pool.request()
    .input('uid', sql.Int, user.id)
    .query(`
      SELECT s.slot_id, sl.game_id, sl.start_min, sl.label, g.name, g.open_play
      FROM bo_signups s
      JOIN bo_game_slots sl ON sl.id = s.slot_id
      JOIN bo_games g ON g.id = sl.game_id
      WHERE s.user_id = @uid`);
  const mine = mineR.recordset;

  if (mine.some(m => m.slot_id === sid)) {
    return json({ error: `You're already in ${slot.name} at ${slot.label}` }, 409);
  }
  const signupMax = signupMaxFor(team);
  if (mine.length >= signupMax) {
    return json({ error: `You can sign up for a maximum of ${signupMax} games` }, 409);
  }
  // Walk-up games (open_play) are allowed to overlap — a player can report to a
  // walk-up window even while signed up for a fixed-time game. Only enforce the
  // no-overlap rule between two FIXED-time games.
  if (!slot.open_play) {
    const clash = mine.find(m => !m.open_play && slotsOverlap(m.start_min, slot.start_min));
    if (clash) {
      return json({ error: `That overlaps with ${clash.name} at ${clash.label} — pick another time` }, 409);
    }
  }

  // Per-tribe slot capacity — ATOMIC. This is the authority (the checks above
  // are fast, friendly pre-validation off a possibly-cached view). We take an
  // UPDLOCK/HOLDLOCK on THIS slot's row so every request competing for the same
  // slot serializes: each one re-counts under the lock and inserts only if
  // there's still room. Different slots lock different rows, so unrelated
  // sign-ups never block each other. The lock lives in the DB, so it holds even
  // across separate SWA Function instances. Single-row lock per request ⇒ no
  // deadlock cycle.
  const ins = await pool.request()
    .input('uid', sql.Int, user.id)
    .input('sid', sql.Int, sid)
    .input('team', sql.NVarChar, team)
    .query(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
        DECLARE @cap INT;
        SELECT @cap = CASE WHEN @team = 'buffalo' THEN cap_buffalo ELSE cap_roadhouse END
          FROM bo_game_slots WITH (UPDLOCK, HOLDLOCK) WHERE id = @sid;
        DECLARE @n INT = (
          SELECT COUNT(*) FROM bo_signups s JOIN bo_users u ON u.id = s.user_id
          WHERE s.slot_id = @sid AND u.team = @team
        );
        DECLARE @already INT = CASE WHEN EXISTS
          (SELECT 1 FROM bo_signups WHERE user_id = @uid AND slot_id = @sid) THEN 1 ELSE 0 END;
        DECLARE @inserted INT = 0;
        IF @already = 0 AND @cap IS NOT NULL AND @n < @cap
        BEGIN
          INSERT INTO bo_signups (user_id, slot_id) VALUES (@uid, @sid);
          SET @inserted = 1;
        END
      COMMIT TRANSACTION;
      SELECT @inserted AS inserted, @already AS already;`);

  const row = ins.recordset[0] || {};
  if (!row.inserted && !row.already) {
    // Lost the race — someone else took the last spot between our read and write.
    return json({ error: `That ${slot.label} slot just filled up for your tribe — grab another time` }, 409);
  }

  return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
}

async function handleCancel(pool, user, slotId) {
  const sid = parseInt(slotId, 10);
  if (!Number.isInteger(sid)) return json({ error: 'slotId is required' }, 400);
  await pool.request()
    .input('uid', sql.Int, user.id)
    .input('sid', sql.Int, sid)
    .query('DELETE FROM bo_signups WHERE user_id = @uid AND slot_id = @sid');
  return json({ bootstrap: await buildBootstrap(pool, user, { fresh: true }) });
}

app.http('signups', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'signups/{slotId?}',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      const pool = await getPool();

      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return await handleSignup(pool, user, body.slotId);
      }
      // DELETE /api/signups/{slotId}
      return await handleCancel(pool, user, request.params.slotId);
    } catch (err) {
      context.error('signups error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
