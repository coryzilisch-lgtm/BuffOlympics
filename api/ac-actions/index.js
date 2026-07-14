const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const { json, requireUser, requireAdmin, hashPassword } = require('../lib/auth');
const { getSettings, upsertSetting, bustSharedBootstrap } = require('../lib/bootstrap');

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

  if (action === 'resetPassword') {
    // Admin-driven password reset — the event has no email/SMTP infra, so when
    // someone forgets their password the admin sets a new one from the People
    // tab and tells them in person. Works for players (email login) and refs
    // (username login) alike. New password takes effect immediately.
    const pw = String(body.password || '');
    if (pw.length < 4) return json({ error: 'New password must be at least 4 characters' }, 400);
    await pool.request()
      .input('id', sql.Int, userId)
      .input('pw', sql.NVarChar, hashPassword(pw))
      .query('UPDATE bo_users SET password_hash = @pw WHERE id = @id');
    return json({ ok: true });
  }

  if (action === 'removeUser') {
    // Delete a user and their event participation (sign-ups, dip, relay, ref
    // assignment). Leaves logged score history (bo_results) intact. Handy for
    // clearing out test/bogus accounts — e.g. after a concurrency load test.
    await pool.request().input('id', sql.Int, userId).query('DELETE FROM bo_signups WHERE user_id = @id');
    await pool.request().input('id', sql.Int, userId).query('DELETE FROM bo_dip_votes WHERE user_id = @id');
    await pool.request().input('id', sql.Int, userId).query('DELETE FROM bo_dip_entries WHERE user_id = @id');
    await pool.request().input('id', sql.Int, userId).query('DELETE FROM bo_relay_signups WHERE user_id = @id');
    await pool.request().input('id', sql.Int, userId).query('DELETE FROM bo_ref_assignments WHERE user_id = @id');
    await pool.request().input('id', sql.Int, userId).query('DELETE FROM bo_users WHERE id = @id');
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

  return json({ error: 'action must be toggleAdmin, toggleRef, addGame, removeGame, resetPassword, or removeUser' }, 400);
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

// ── POST /api/admin/idols ──────────────────────────────────────────────────
// Idol clues are hidden by default; the admin types clues, sets release times
// (minutes since midnight, event-local), and marks one found when claimed.
async function handleIdols(pool, body) {
  const action = body.action;

  if (action === 'add') {
    await pool.request().query(`
      INSERT INTO bo_idols (title, clue, release_min, found, sort)
      SELECT N'New clue', N'', NULL, 0, ISNULL(MAX(sort), 0) + 1 FROM bo_idols;`);
    return json({ ok: true });
  }

  const id = parseInt(body.id, 10);
  if (!Number.isInteger(id)) return json({ error: 'id is required' }, 400);

  if (action === 'remove') {
    await pool.request().input('id', sql.Int, id).query('DELETE FROM bo_idols WHERE id = @id');
    return json({ ok: true });
  }

  if (action === 'toggleFound') {
    await pool.request().input('id', sql.Int, id)
      .query('UPDATE bo_idols SET found = CASE WHEN found = 1 THEN 0 ELSE 1 END WHERE id = @id');
    return json({ ok: true });
  }

  if (action === 'update') {
    const sets = [];
    const req = pool.request().input('id', sql.Int, id);
    if (body.title !== undefined) { sets.push('title = @title'); req.input('title', sql.NVarChar, String(body.title)); }
    if (body.clue !== undefined) { sets.push('clue = @clue'); req.input('clue', sql.NVarChar, String(body.clue)); }
    if (body.releaseMin !== undefined) {
      const rm = body.releaseMin === null || body.releaseMin === '' ? null : parseInt(body.releaseMin, 10);
      sets.push('release_min = @rm');
      req.input('rm', sql.Int, Number.isInteger(rm) ? rm : null);
    }
    if (body.found !== undefined) { sets.push('found = @found'); req.input('found', sql.Bit, body.found ? 1 : 0); }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    await req.query(`UPDATE bo_idols SET ${sets.join(', ')} WHERE id = @id`);
    return json({ ok: true });
  }

  return json({ error: 'action must be add, remove, update, or toggleFound' }, 400);
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

// ── POST /api/ac/games ─────────────────────────────────────────────────────
// Games + slots CRUD. Designed to be SAFE to run mid-event: editing or adding
// never touches bo_signups, and removing a slot/game deletes only that thing's
// sign-ups (slot IDs are IDENTITY and stable, so an UPDATE keeps everyone in).
function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'game';
}
function toInt(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : dflt;
}

async function handleGames(pool, body) {
  const action = body.action;

  // ── games ──
  if (action === 'addGame') {
    const name = String(body.name || '').trim();
    if (!name) return json({ error: 'Game name is required' }, 400);
    // Derive a unique id from the name (append -2, -3, … on collision).
    const base = slugify(name);
    const existR = await pool.request().query('SELECT id FROM bo_games');
    const taken = new Set(existR.recordset.map(r => r.id));
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}-${n++}`.slice(0, 20);
    const sortR = await pool.request().query('SELECT ISNULL(MAX(sort), 0) + 1 AS next FROM bo_games');
    await pool.request()
      .input('id', sql.NVarChar, id)
      .input('name', sql.NVarChar, name)
      .input('time_label', sql.NVarChar, String(body.timeLabel || '').trim() || null)
      .input('needs_ref', sql.Bit, body.needsRef ? 1 : 0)
      .input('venue', sql.NVarChar, String(body.venue || '').trim() || null)
      .input('open_play', sql.Bit, body.openPlay ? 1 : 0)
      .input('sort', sql.Int, sortR.recordset[0].next)
      .query(`
        INSERT INTO bo_games (id, name, block, cap, players, time_label, points_label,
                              needs_ref, venue, descr, inventory, video_url, open_play, sort)
        VALUES (@id, @name, NULL, 0, NULL, @time_label, NULL,
                @needs_ref, @venue, NULL, NULL, NULL, @open_play, @sort)`);
    return json({ ok: true, id });
  }

  if (action === 'updateGame') {
    const gameId = String(body.gameId || '').trim();
    if (!gameId) return json({ error: 'gameId is required' }, 400);
    const map = { name: 'name', timeLabel: 'time_label', venue: 'venue' };
    const sets = [];
    const req = pool.request().input('gid', sql.NVarChar, gameId);
    for (const [k, col] of Object.entries(map)) {
      if (body[k] !== undefined) {
        const v = String(body[k]).trim();
        if (col === 'name' && !v) return json({ error: 'Game name cannot be empty' }, 400);
        sets.push(`${col} = @${col}`);
        req.input(col, sql.NVarChar, v || null);
      }
    }
    if (body.needsRef !== undefined) { sets.push('needs_ref = @needs_ref'); req.input('needs_ref', sql.Bit, body.needsRef ? 1 : 0); }
    if (body.openPlay !== undefined) { sets.push('open_play = @open_play'); req.input('open_play', sql.Bit, body.openPlay ? 1 : 0); }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    const r = await req.query(`UPDATE bo_games SET ${sets.join(', ')} WHERE id = @gid`);
    if (!r.rowsAffected[0]) return json({ error: 'Game not found' }, 404);
    return json({ ok: true });
  }

  if (action === 'removeGame') {
    const gameId = String(body.gameId || '').trim();
    if (!gameId) return json({ error: 'gameId is required' }, 400);
    // Only this game's sign-ups are affected.
    await pool.request().input('gid', sql.NVarChar, gameId)
      .query('DELETE FROM bo_signups WHERE slot_id IN (SELECT id FROM bo_game_slots WHERE game_id = @gid)');
    await pool.request().input('gid', sql.NVarChar, gameId)
      .query('DELETE FROM bo_game_slots WHERE game_id = @gid');
    await pool.request().input('gid', sql.NVarChar, gameId)
      .query('DELETE FROM bo_ref_assignments WHERE game_id = @gid');
    await pool.request().input('gid', sql.NVarChar, gameId)
      .query('DELETE FROM bo_games WHERE id = @gid');
    return json({ ok: true });
  }

  // ── slots ──
  if (action === 'addSlot') {
    const gameId = String(body.gameId || '').trim();
    if (!gameId) return json({ error: 'gameId is required' }, 400);
    const gR = await pool.request().input('gid', sql.NVarChar, gameId)
      .query('SELECT id FROM bo_games WHERE id = @gid');
    if (!gR.recordset.length) return json({ error: 'Game not found' }, 404);
    const startMin = toInt(body.startMin, null);
    const label = String(body.label || '').trim();
    if (startMin === null) return json({ error: 'startMin is required' }, 400);
    if (!label) return json({ error: 'A time label is required' }, 400);
    const sortR = await pool.request().input('gid', sql.NVarChar, gameId)
      .query('SELECT ISNULL(MAX(sort), -1) + 1 AS next FROM bo_game_slots WHERE game_id = @gid');
    await pool.request()
      .input('gid', sql.NVarChar, gameId)
      .input('start_min', sql.Int, startMin)
      .input('label', sql.NVarChar, label)
      .input('cb', sql.Int, Math.max(0, toInt(body.capBuffalo, 0)))
      .input('cr', sql.Int, Math.max(0, toInt(body.capRoadhouse, 0)))
      .input('sort', sql.Int, sortR.recordset[0].next)
      .query(`
        INSERT INTO bo_game_slots (game_id, start_min, label, cap_buffalo, cap_roadhouse, sort)
        VALUES (@gid, @start_min, @label, @cb, @cr, @sort)`);
    return json({ ok: true });
  }

  if (action === 'updateSlot') {
    const slotId = toInt(body.slotId, null);
    if (slotId === null) return json({ error: 'slotId is required' }, 400);
    const sets = [];
    const req = pool.request().input('sid', sql.Int, slotId);
    if (body.startMin !== undefined) { sets.push('start_min = @start_min'); req.input('start_min', sql.Int, toInt(body.startMin, 0)); }
    if (body.label !== undefined) {
      const label = String(body.label).trim();
      if (!label) return json({ error: 'A time label is required' }, 400);
      sets.push('label = @label'); req.input('label', sql.NVarChar, label);
    }
    if (body.capBuffalo !== undefined) { sets.push('cap_buffalo = @cb'); req.input('cb', sql.Int, Math.max(0, toInt(body.capBuffalo, 0))); }
    if (body.capRoadhouse !== undefined) { sets.push('cap_roadhouse = @cr'); req.input('cr', sql.Int, Math.max(0, toInt(body.capRoadhouse, 0))); }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    const r = await req.query(`UPDATE bo_game_slots SET ${sets.join(', ')} WHERE id = @sid`);
    if (!r.rowsAffected[0]) return json({ error: 'Slot not found' }, 404);
    return json({ ok: true });
  }

  if (action === 'removeSlot') {
    const slotId = toInt(body.slotId, null);
    if (slotId === null) return json({ error: 'slotId is required' }, 400);
    await pool.request().input('sid', sql.Int, slotId)
      .query('DELETE FROM bo_signups WHERE slot_id = @sid');
    await pool.request().input('sid', sql.Int, slotId)
      .query('DELETE FROM bo_game_slots WHERE id = @sid');
    return json({ ok: true });
  }

  return json({ error: 'action must be addGame, updateGame, removeGame, addSlot, updateSlot, or removeSlot' }, 400);
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

      let resp;
      if (action === 'settings') resp = await handleSettings(pool, body);
      else if (action === 'people') resp = await handlePeople(pool, body);
      else if (action === 'relay-legs') resp = await handleRelayLegs(pool, body);
      else if (action === 'announcements') resp = await handleAnnouncements(pool, body);
      else if (action === 'schedule') resp = await handleSchedule(pool, body);
      else if (action === 'ref-assign') resp = await handleRefAssign(pool, body);
      else if (action === 'games') resp = await handleGames(pool, body);
      else if (action === 'idols') resp = await handleIdols(pool, body);
      else return json({ error: 'Unknown admin action' }, 404);

      // Every admin write can change the shared bootstrap block — drop the
      // cached copy so players pick up the change on their next poll.
      bustSharedBootstrap();
      return resp;
    } catch (err) {
      context.error('admin-actions error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
