const crypto = require('crypto');
const { getPool, sql } = require('./db');

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const NO_STORE = { 'Cache-Control': 'no-store' };

// Standard JSON response with Cache-Control: no-store on everything.
function json(body, status = 200) {
  return { status, jsonBody: body, headers: NO_STORE };
}

// ── passwords ──────────────────────────────────────────────────────────────
// Stored as: pbkdf2$100000$<saltB64>$<hashB64>  (PBKDF2-SHA256, 16-byte salt)

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    if (!iterations || !salt.length || !expected.length) return false;
    const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Timing-safe comparison of two arbitrary strings (used for the ref join
// code). Hashing both sides first makes the buffers equal-length, so
// timingSafeEqual never throws and the comparison leaks nothing.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ── session tokens ─────────────────────────────────────────────────────────
// base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, SESSION_SECRET))
// payload = { uid: <int>, exp: <unix seconds>, tv: <int token_version> }
// `tv` (migration 013) must match bo_users.token_version — an admin password
// reset bumps the column, killing every session issued before the reset.
// Old tokens carry no tv (reads as 0) and pre-013 rows have no column (also
// 0), so everything already issued stays valid until a reset touches it.

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET app setting is not configured');
  return secret;
}

function signToken(uid, tokenVersion) {
  const payloadJson = JSON.stringify({
    uid,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    tv: tokenVersion || 0,
  });
  const body = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadJson).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot < 0) return null;
    const payloadJson = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    const expected = crypto.createHmac('sha256', getSecret()).update(payloadJson).digest();
    const actual = Buffer.from(token.slice(dot + 1), 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(payloadJson);
    if (!payload || !Number.isInteger(payload.uid)) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── identity ───────────────────────────────────────────────────────────────

// Reads the X-Auth-Token custom header (SWA rewrites Authorization, so we
// never use it), verifies the HMAC token, and loads the user row from
// bo_users. Returns the raw DB row or null.
async function identityFromRequest(request) {
  const token = request.headers.get('x-auth-token');
  const payload = verifyToken(token);
  if (!payload) return null;
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, payload.uid)
    .query('SELECT * FROM bo_users WHERE id = @id');
  const row = r.recordset[0] || null;
  // Token-version check (migration 013): a password reset bumps the row's
  // token_version, so tokens minted before the reset stop matching → 401.
  // Pre-013 the column is absent (undefined → 0) and old tokens have no tv
  // (→ 0), so nothing already issued breaks.
  if (row && (payload.tv || 0) !== (row.token_version || 0)) return null;
  return row;
}

// Convenience alias — handlers call this and 401 on null.
async function requireUser(request) {
  return identityFromRequest(request);
}

function requireRef(user) {
  return !!(user && (user.is_ref || user.is_admin));
}

function requireAdmin(user) {
  return !!(user && user.is_admin);
}

// ── display names / user shaping ──────────────────────────────────────────

// "Jordan Lee" -> "Jordan L." — or the username for refs with no name.
function formatName(first, last, username) {
  const f = (first || '').trim();
  const l = (last || '').trim();
  if (f && l) return `${f} ${l[0].toUpperCase()}.`;
  if (f) return f;
  return (username || '').trim() || 'Player';
}

function userToJson(row) {
  return {
    id: row.id,
    email: row.email || null,
    username: row.username || null,
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    name: formatName(row.first_name, row.last_name, row.username),
    team: row.team || null,
    shirtSize: row.shirt_size || null,
    years: row.years || null,
    songRequest: row.song_request || null,
    isRef: !!row.is_ref,
    isAdmin: !!row.is_admin,
  };
}

// ADMIN_EMAILS app setting = comma-separated bootstrap admin emails.
function isBootstrapAdmin(email) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email).trim().toLowerCase());
}

module.exports = {
  json,
  hashPassword,
  verifyPassword,
  timingSafeEqualStr,
  signToken,
  verifyToken,
  identityFromRequest,
  requireUser,
  requireRef,
  requireAdmin,
  formatName,
  userToJson,
  isBootstrapAdmin,
};
