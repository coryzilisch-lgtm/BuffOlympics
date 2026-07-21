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

  // Uniqueness is enforced ATOMICALLY by the ux_bo_users_email unique index — a
  // duplicate email raises SQL error 2601/2627, which we turn into a friendly
  // 409. This is the correct atomic guard: no check-then-insert race, and no
  // `OUTPUT INSERTED.*` inside an IF/transaction batch — that combination
  // returned no recordset through the mssql driver and 500'd EVERY signup.
  let r;
  try {
    r = await pool.request()
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
  } catch (e) {
    if (e && (e.number === 2601 || e.number === 2627)) {
      return json({ error: 'An account with that email already exists' }, 409);
    }
    throw e;
  }
  const user = r.recordset[0];
  if (!user) return json({ error: 'An account with that email already exists' }, 409);
  return json({ token: signToken(user.id, user.token_version), user: userToJson(user) });
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
  return json({ token: signToken(user.id, user.token_version), user: userToJson(user) });
}

async function refLogin(pool, body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const user = username ? await findByUsername(pool, username) : null;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return json({ error: 'Invalid username or password' }, 401);
  }
  return json({ token: signToken(user.id, user.token_version), user: userToJson(user) });
}

async function refCreate(pool, body) {
  const password = String(body.password || '');
  const joinCode = String(body.joinCode || '').trim();
  if (!password) return json({ error: 'Password is required' }, 400);

  const settings = await getSettings(pool);
  if (!settings.refJoinCode
    || !timingSafeEqualStr(joinCode.toLowerCase(), settings.refJoinCode.trim().toLowerCase())) {
    return json({ error: 'bad_code' }, 403);
  }

  // Full-profile path — refs fill in the SAME fields as players (first/last
  // name, email, shirt size, …) minus the tribe (refs are neutral). They then
  // sign back in through the normal email/password sign-in.
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();
  if (email || firstName || lastName) {
    if (!firstName || !lastName) return json({ error: 'First and last name are required' }, 400);
    if (!email) return json({ error: 'Email is required' }, 400);
    // Same atomic email-uniqueness as the player signup: the unique index
    // enforces it and a duplicate (2601/2627) becomes a 409.
    let r;
    try {
      r = await pool.request()
        .input('email', sql.NVarChar, email)
        .input('password_hash', sql.NVarChar, hashPassword(password))
        .input('first_name', sql.NVarChar, firstName)
        .input('last_name', sql.NVarChar, lastName)
        .input('shirt_size', sql.NVarChar, body.shirtSize ? String(body.shirtSize) : null)
        .input('years', sql.NVarChar, body.years ? String(body.years) : null)
        .input('song_request', sql.NVarChar, body.songRequest ? String(body.songRequest) : null)
        .query(`
          INSERT INTO bo_users
            (email, password_hash, first_name, last_name, shirt_size, years, song_request, is_ref, is_admin)
          OUTPUT INSERTED.*
          VALUES
            (@email, @password_hash, @first_name, @last_name, @shirt_size, @years, @song_request, 1, 0);
        `);
    } catch (e) {
      if (e && (e.number === 2601 || e.number === 2627)) {
        return json({ error: 'An account with that email already exists' }, 409);
      }
      throw e;
    }
    const user = r.recordset[0];
    if (!user) return json({ error: 'An account with that email already exists' }, 409);
    return json({ token: signToken(user.id, user.token_version), user: userToJson(user) });
  }

  // Legacy username-only path (pre-existing ref accounts sign in via ref-login).
  const username = String(body.username || '').trim();
  if (!username) return json({ error: 'First and last name are required' }, 400);
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
  return json({ token: signToken(user.id, user.token_version), user: userToJson(user) });
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
      // TEMPORARY diagnostic: SWA managed-function logs are hard to reach, so
      // surface the DB error on the 500 to root-cause the signup failure from
      // the browser Network tab. REMOVE once the cause is understood.
      return json({
        error: 'Internal server error',
        detail: err && err.message,
        code: err && (err.number != null ? err.number : err.code),
        name: err && err.name,
      }, 500);
    }
  },
});
