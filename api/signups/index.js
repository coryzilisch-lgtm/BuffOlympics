const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap, getSettings } = require('../lib/bootstrap');
const { blockById, slotsOverlap } = require('../lib/blocks');

const MAX_GAMES = 2;

async function handleSignup(pool, user, gameId) {
  if (!gameId) return json({ error: 'gameId is required' }, 400);
  if (!user.team) return json({ error: 'Pick your tribe before signing up' }, 409);

  const settings = await getSettings(pool);
  if (settings.eventMode !== 'signup') {
    return json({ error: "Signups are locked — it's game day!" }, 409);
  }

  const gameR = await pool.request()
    .input('id', sql.NVarChar, gameId)
    .query('SELECT id, name, block, cap, open_play FROM bo_games WHERE id = @id');
  const game = gameR.recordset[0];
  if (!game) return json({ error: 'Game not found' }, 404);
  if (game.open_play) return json({ error: `${game.name} is open play — just walk up on game day` }, 409);

  const mineR = await pool.request()
    .input('uid', sql.Int, user.id)
    .query(`
      SELECT s.game_id, g.name, g.block
      FROM bo_signups s JOIN bo_games g ON g.id = s.game_id
      WHERE s.user_id = @uid`);
  const mine = mineR.recordset;

  if (mine.some(m => m.game_id === game.id)) {
    return json({ error: `You're already signed up for ${game.name}` }, 409);
  }
  if (mine.length >= MAX_GAMES) {
    return json({ error: `You can sign up for a maximum of ${MAX_GAMES} games` }, 409);
  }

  const targetBlock = blockById(game.block);
  const targetSlot = targetBlock ? targetBlock.slot : null;
  for (const m of mine) {
    const b = blockById(m.block);
    if (slotsOverlap(targetSlot, b ? b.slot : null)) {
      return json({ error: `That time block overlaps with ${m.name} — pick a game in another rotation` }, 409);
    }
  }

  const capR = await pool.request()
    .input('gid', sql.NVarChar, game.id)
    .input('team', sql.NVarChar, user.team)
    .query(`
      SELECT COUNT(*) AS n
      FROM bo_signups s JOIN bo_users u ON u.id = s.user_id
      WHERE s.game_id = @gid AND u.team = @team`);
  if (capR.recordset[0].n >= game.cap) {
    return json({ error: `${game.name} is full for your tribe` }, 409);
  }

  await pool.request()
    .input('uid', sql.Int, user.id)
    .input('gid', sql.NVarChar, game.id)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM bo_signups WHERE user_id = @uid AND game_id = @gid)
        INSERT INTO bo_signups (user_id, game_id) VALUES (@uid, @gid);`);

  return json({ bootstrap: await buildBootstrap(pool, user) });
}

async function handleCancel(pool, user, gameId) {
  if (!gameId) return json({ error: 'gameId is required' }, 400);
  await pool.request()
    .input('uid', sql.Int, user.id)
    .input('gid', sql.NVarChar, gameId)
    .query('DELETE FROM bo_signups WHERE user_id = @uid AND game_id = @gid');
  return json({ bootstrap: await buildBootstrap(pool, user) });
}

app.http('signups', {
  methods: ['POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'signups/{gameId?}',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      const pool = await getPool();

      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return await handleSignup(pool, user, body.gameId);
      }
      // DELETE /api/signups/{gameId}
      return await handleCancel(pool, user, request.params.gameId);
    } catch (err) {
      context.error('signups error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
