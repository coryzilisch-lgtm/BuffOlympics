const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');
const {
  json, hashPassword, verifyPassword, timingSafeEqualStr,
  signToken, userToJson, isBootstrapAdmin,
} = require('../lib/auth');
const { getSettings } = require('../lib/bootstrap');

const TEAMS = ['buffalo', 'roadhouse'];

async function findByEmail(pool, email) {
  const r = await pool.request()
    .input('email', sql.NVarChar, email)
    .query('SELECT * FROM bo_users WHERE LOWER(email) = LOWER(@email)');
  return r.recordset[0] || null;
}

async function findByUsername(pool, username) {
  const r = await pool.request()
    .input('username', sql.NVarChar, username)
    .query('SELECT * FROM bo_users WHERE LOWER(username) = LOWER(@username)');
  return r.recordset[0] || null;
}

async function signup(pool, body) {
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const team = body.team;

  if (!firstName || !lastName) return json({ error: 'First and last name are required' }, 400);
  if (!email) return json({ error: 'Email is required' }, 400);
  if (!password) return json({ error: 'Password is required' }, 400);
  if (!TEAMS.includes(team)) return json({ error: 'Pick a tribe — buffalo or roadhouse' }, 400);

  if (await findByEmail(pool, email)) {
    return json({ error: 'An account with that email already exists' }, 409);
  }

  const r = await pool.request()
    .input('email', sql.NVarChar, email)
    .input('password_hash', sql.NVarChar, hashPassword(password))
    .input('first_name', sql.NVarChar, firstName)
    .input('last_name', sql.NVarChar, lastName)
    .input('team', sql.NVarChar, team)
    .input('shirt_size', sql.NVarChar, body.shirtSize ? String(body.shirtSize) : null)
    .input('years', sql.NVarChar, body.years ? String(body.years) : null)
    .input('song_request', sql.NVarChar, body.songRequest ? String(body.songRequest) : null)
    .input('is_admin', sql.Bit, isBootstrapAdmin(email) ? 1 : 0)
    .query(`
      INSERT INTO bo_users
        (email, password_hash, first_name, last_name, team, shirt_size, years, song_request, is_ref, is_admin)
      OUTPUT INSERTED.*
      VALUES
        (@email, @password_hash, @first_name, @last_name, @team, @shirt_size, @years, @song_request, 0, @is_admin);
    `);
  const user = r.recordset[0];
  return json({ token: signToken(user.id), user: userToJson(user) });
}

async function signin(pool, body) {
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const user = email ? await findByEmail(pool, email) : null;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return json({ error: 'Invalid email or password' }, 401);
  }
  // Bootstrap admins: ensure is_admin = 1 on every signin too.
  if (isBootstrapAdmin(user.email) && !user.is_admin) {
    await pool.request().input('id', sql.Int, user.id)
      .query('UPDATE bo_users SET is_admin = 1 WHERE id = @id');
    user.is_admin = true;
  }
  return json({ token: signToken(user.id), user: userToJson(user) });
}

async function refLogin(pool, body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = username ? await findByUsername(pool, username) : null;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return json({ error: 'Invalid username or password' }, 401);
  }
  return json({ token: signToken(user.id), user: userToJson(user) });
}

async function refCreate(pool, body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const joinCode = String(body.joinCode || '').trim();

  if (!username) return json({ error: 'Username is required' }, 400);
  if (!password) return json({ error: 'Password is required' }, 400);

  const settings = await getSettings(pool);
  if (!settings.refJoinCode
    || !timingSafeEqualStr(joinCode.toLowerCase(), settings.refJoinCode.trim().toLowerCase())) {
    return json({ error: 'bad_code' }, 403);
  }

  if (await findByUsername(pool, username)) {
    return json({ error: 'That username is taken' }, 409);
  }

  const r = await pool.request()
    .input('username', sql.NVarChar, username)
    .input('password_hash', sql.NVarChar, hashPassword(password))
    .query(`
      INSERT INTO bo_users (username, password_hash, is_ref, is_admin)
      OUTPUT INSERTED.*
      VALUES (@username, @password_hash, 1, 0);
    `);
  const user = r.recordset[0];
  return json({ token: signToken(user.id), user: userToJson(user) });
}

app.http('auth', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/{action}',
  handler: async (request, context) => {
    try {
      const action = request.params.action;
      const body = await request.json().catch(() => ({}));
      const pool = await getPool();
      if (action === 'signup') return await signup(pool, body);
      if (action === 'signin') return await signin(pool, body);
      if (action === 'ref-login') return await refLogin(pool, body);
      if (action === 'ref-create') return await refCreate(pool, body);
      return json({ error: 'Unknown auth action' }, 404);
    } catch (err) {
      context.error('auth error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
