const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap, getSettings, slotsOverlap, SIGNUP_MAX } = require('../lib/bootstrap');

// Sign up for a SLOT (a specific 5-minute time within a game). Enforces, all
// server-side: signup phase only, slot exists, my tribe has room in that slot,
// the SIGNUP_MAX (2) cap across the day, and no two of my slots overlap in time.
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
      SELECT sl.id, sl.game_id, sl.start_min, sl.label, sl.cap_buffalo, sl.cap_roadhouse, g.name
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
      SELECT s.slot_id, sl.game_id, sl.start_min, sl.label, g.name
      FROM bo_signups s
      JOIN bo_game_slots sl ON sl.id = s.slot_id
      JOIN bo_games g ON g.id = sl.game_id
      WHERE s.user_id = @uid`);
  const mine = mineR.recordset;

  if (mine.some(m => m.slot_id === sid)) {
    return json({ error: `You're already in ${slot.name} at ${slot.label}` }, 409);
  }
  if (mine.length >= SIGNUP_MAX) {
    return json({ error: `You can sign up for a maximum of ${SIGNUP_MAX} games` }, 409);
  }
  const clash = mine.find(m => slotsOverlap(m.start_min, slot.start_min));
  if (clash) {
    return json({ error: `That overlaps with ${clash.name} at ${clash.label} — pick another time` }, 409);
  }

  // Per-tribe slot capacity.
  const capR = await pool.request()
    .input('sid', sql.Int, sid)
    .input('team', sql.NVarChar, team)
    .query(`
      SELECT COUNT(*) AS n
      FROM bo_signups s JOIN bo_users u ON u.id = s.user_id
      WHERE s.slot_id = @sid AND u.team = @team`);
  if (capR.recordset[0].n >= teamCap) {
    return json({ error: `That ${slot.label} slot is full for your tribe` }, 409);
  }

  await pool.request()
    .input('uid', sql.Int, user.id)
    .input('sid', sql.Int, sid)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM bo_signups WHERE user_id = @uid AND slot_id = @sid)
        INSERT INTO bo_signups (user_id, slot_id) VALUES (@uid, @sid);`);

  return json({ bootstrap: await buildBootstrap(pool, user) });
}

async function handleCancel(pool, user, slotId) {
  const sid = parseInt(slotId, 10);
  if (!Number.isInteger(sid)) return json({ error: 'slotId is required' }, 400);
  await pool.request()
    .input('uid', sql.Int, user.id)
    .input('sid', sql.Int, sid)
    .query('DELETE FROM bo_signups WHERE user_id = @uid AND slot_id = @sid');
  return json({ bootstrap: await buildBootstrap(pool, user) });
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
