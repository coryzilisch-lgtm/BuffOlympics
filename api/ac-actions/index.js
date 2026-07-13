const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireAdmin } = require('../lib/auth');
const { getSettings, upsertSetting } = require('../lib/bootstrap');

// ── POST /api/admin/settings ───────────────────────────────────────────────
async function handleSettings(pool, body) {
  if (body.eventMode !== undefined) {
    if (body.eventMode !== 'signup' && body.eventMode !== 'gameday') {
      return json({ error: "eventMode must be 'signup' or 'gameday'" }, 400);
    }
    await upsertSetting(pool, 'event_mode', body.eventMode);
  }
  if (body.refJoinCode !== undefined) {
    const code = String(body.refJoinCode || '').trim();
    if (!code) return json({ error: 'refJoinCode cannot be empty' }, 400);
    await upsertSetting(pool, 'ref_join_code', code);
  }
  if (body.scoresRevealed !== undefined) {
    // One-way: once revealed, scores can't be un-revealed.
    if (body.scoresRevealed === true) {
      await upsertSetting(pool, 'scores_revealed', '1');
    }
  }
  if (body.dipRevealed !== undefined) {
    await upsertSetting(pool, 'dip_revealed', body.dipRevealed ? '1' : '0');
  }
  const settings = await getSettings(pool);
  return json({ settings });
}

// ── POST /api/admin/people ─────────────────────────────────────────────────
// Admin override: addGame/removeGame ignore caps, limits, and event mode.
async function handlePeople(pool, body) {
  const userId = parseInt(body.userId, 10);
  if (!Number.isInteger(userId)) return json({ error: 'userId is required' }, 400);

  const userR = await pool.request()
    .input('id', sql.Int, userId)
    .query('SELECT id FROM bo_users WHERE id = @id');
  if (!userR.recordset.length) return json({ error: 'User not found' }, 404);

  const action = body.action;
  if (action === 'toggleAdmin' || action === 'toggleRef') {
    const col = action === 'toggleAdmin' ? 'is_admin' : 'is_ref';
    await pool.request()
      .input('id', sql.Int, userId)
      .query(`UPDATE bo_users SET ${col} = CASE WHEN ${col} = 1 THEN 0 ELSE 1 END WHERE id = @id`);
    return json({ ok: true });
  }

  if (action === 'addGame' || action === 'removeGame') {
    const gameId = String(body.gameId || '').trim();
    if (!gameId) return json({ error: 'gameId is required' }, 400);
    if (action === 'addGame') {
      // Admin override: drop the person into the earliest slot of the game
      // (ignoring caps / overlap / event mode). Skip open-play games (no slots).
      const slotR = await pool.request()
        .input('gid', sql.NVarChar, gameId)
        .query('SELECT TOP 1 id FROM bo_game_slots WHERE game_id = @gid ORDER BY sort, start_min');
      const slot = slotR.recordset[0];
      if (!slot) return json({ error: 'That game has no sign-up slots (walk-up game)' }, 409);
      await pool.request()
        .input('uid', sql.Int, userId)
        .input('sid', sql.Int, slot.id)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM bo_signups WHERE user_id = @uid AND slot_id = @sid)
            INSERT INTO bo_signups (user_id, slot_id) VALUES (@uid, @sid);`);
    } else {
      // Remove the person from every slot of this game.
      await pool.request()
        .input('uid', sql.Int, userId)
        .input('gid', sql.NVarChar, gameId)
        .query(`
          DELETE FROM bo_signups
          WHERE user_id = @uid
            AND slot_id IN (SELECT id FROM bo_game_slots WHERE game_id = @gid)`);
    }
    return json({ ok: true });
  }

  return json({ error: 'action must be toggleAdmin, toggleRef, addGame, or removeGame' }, 400);
}

// ── POST /api/admin/relay-legs ─────────────────────────────────────────────
async function handleRelayLegs(pool, body) {
  const legId = String(body.legId || '').trim();
  if (!legId) return json({ error: 'legId is required' }, 400);

  const legR = await pool.request()
    .input('lid', sql.NVarChar, legId)
    .query('SELECT id FROM bo_relay_legs WHERE id = @lid');
  if (!legR.recordset.length) return json({ error: 'Relay leg not found' }, 404);

  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return json({ error: 'Leg name cannot be empty' }, 400);
    await pool.request()
      .input('lid', sql.NVarChar, legId)
      .input('name', sql.NVarChar, name)
      .query('UPDATE bo_relay_legs SET name = @name WHERE id = @lid');
  }
  if (body.capDelta !== undefined) {
    const d = parseInt(body.capDelta, 10);
    if (!Number.isInteger(d)) return json({ error: 'capDelta must be a number' }, 400);
    // cap floor is 1
    await pool.request()
      .input('lid', sql.NVarChar, legId)
      .input('d', sql.Int, d)
      .query('UPDATE bo_relay_legs SET cap = CASE WHEN cap + @d < 1 THEN 1 ELSE cap + @d END WHERE id = @lid');
  }
  return json({ ok: true });
}

// ── POST /api/admin/announcements ──────────────────────────────────────────
async function handleAnnouncements(pool, body) {
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  if (!title && !text) return json({ error: 'Give the announcement a title or a body' }, 400);
  await pool.request()
    .input('title', sql.NVarChar, title || 'Untitled announcement')
    .input('body', sql.NVarChar, text)
    .query('INSERT INTO bo_announcements (title, body) VALUES (@title, @body)');
  return json({ ok: true });
}

// ── POST /api/admin/schedule ───────────────────────────────────────────────
async function handleSchedule(pool, body) {
  const action = body.action;

  if (action === 'add') {
    await pool.request().query(`
      INSERT INTO bo_schedule (time_label, ampm, title, place, kind, sort)
      SELECT N'5:00', N'PM', N'New Block', N'TBD', N'up', ISNULL(MAX(sort), 0) + 1 FROM bo_schedule;`);
    return json({ ok: true });
  }

  const id = parseInt(body.id, 10);

  if (action === 'remove') {
    if (!Number.isInteger(id)) return json({ error: 'id is required' }, 400);
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM bo_schedule WHERE id = @id');
    return json({ ok: true });
  }

  if (action === 'move') {
    if (!Number.isInteger(id)) return json({ error: 'id is required' }, 400);
    const dir = parseInt(body.dir, 10);
    if (dir !== -1 && dir !== 1) return json({ error: 'dir must be -1 or 1' }, 400);
    const rowsR = await pool.request().query('SELECT id FROM bo_schedule ORDER BY sort, id');
    const ids = rowsR.recordset.map(r => r.id);
    const i = ids.indexOf(id);
    if (i < 0) return json({ error: 'Schedule row not found' }, 404);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return json({ ok: true }); // already at the edge — no-op
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // Renumber everything sequentially — robust against duplicate sorts.
    for (let k = 0; k < ids.length; k++) {
      await pool.request()
        .input('id', sql.Int, ids[k])
        .input('sort', sql.Int, k + 1)
        .query('UPDATE bo_schedule SET sort = @sort WHERE id = @id');
    }
    return json({ ok: true });
  }

  if (action === 'update') {
    if (!Number.isInteger(id)) return json({ error: 'id is required' }, 400);
    const fields = { timeLabel: 'time_label', ampm: 'ampm', title: 'title', place: 'place', kind: 'kind' };
    const sets = [];
    const req = pool.request().input('id', sql.Int, id);
    for (const [k, col] of Object.entries(fields)) {
      if (body[k] !== undefined) {
        sets.push(`${col} = @${col}`);
        req.input(col, sql.NVarChar, String(body[k]));
      }
    }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    await req.query(`UPDATE bo_schedule SET ${sets.join(', ')} WHERE id = @id`);
    return json({ ok: true });
  }

  return json({ error: 'action must be add, remove, move, or update' }, 400);
}

// ── POST /api/admin/ref-assign ─────────────────────────────────────────────
async function handleRefAssign(pool, body) {
  const gameId = String(body.gameId || '').trim();
  if (!gameId) return json({ error: 'gameId is required' }, 400);

  const gameR = await pool.request()
    .input('gid', sql.NVarChar, gameId)
    .query('SELECT id FROM bo_games WHERE id = @gid');
  if (!gameR.recordset.length) return json({ error: 'Game not found' }, 404);

  const userId = body.userId === null || body.userId === '' || body.userId === undefined
    ? null : parseInt(body.userId, 10);

  if (userId === null) {
    await pool.request().input('gid', sql.NVarChar, gameId)
      .query('DELETE FROM bo_ref_assignments WHERE game_id = @gid');
    return json({ ok: true });
  }

  if (!Number.isInteger(userId)) return json({ error: 'userId must be a number, null, or empty' }, 400);
  const userR = await pool.request().input('id', sql.Int, userId)
    .query('SELECT id FROM bo_users WHERE id = @id');
  if (!userR.recordset.length) return json({ error: 'User not found' }, 404);

  await pool.request()
    .input('gid', sql.NVarChar, gameId)
    .input('uid', sql.Int, userId)
    .query(`
      IF EXISTS (SELECT 1 FROM bo_ref_assignments WHERE game_id = @gid)
        UPDATE bo_ref_assignments SET user_id = @uid WHERE game_id = @gid;
      ELSE
        INSERT INTO bo_ref_assignments (game_id, user_id) VALUES (@gid, @uid);`);
  return json({ ok: true });
}

app.http('ac-actions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'ac/{action}',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      if (!requireAdmin(user)) return json({ error: 'Admin access required' }, 403);

      const action = request.params.action;
      const body = await request.json().catch(() => ({}));
      const pool = await getPool();

      if (action === 'settings') return await handleSettings(pool, body);
      if (action === 'people') return await handlePeople(pool, body);
      if (action === 'relay-legs') return await handleRelayLegs(pool, body);
      if (action === 'announcements') return await handleAnnouncements(pool, body);
      if (action === 'schedule') return await handleSchedule(pool, body);
      if (action === 'ref-assign') return await handleRefAssign(pool, body);
      return json({ error: 'Unknown admin action' }, 404);
    } catch (err) {
      context.error('admin-actions error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
