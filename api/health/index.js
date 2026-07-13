const { app } = require('@azure/functions');
const { getPool, sql } = require('../lib/db');

// Diagnostic endpoint — GET /api/health. Reports whether each required app
// setting is PRESENT (never its value), whether the DB connects, and whether
// the seed tables exist. Safe to leave in; remove later if you want. This is
// the fastest way to tell a config problem (SP grant, wrong DB, missing
// SESSION_SECRET) from a code problem.
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    const out = {
      ok: false,
      env: {
        FABRIC_SQL_SERVER: !!process.env.FABRIC_SQL_SERVER,
        FABRIC_SQL_DATABASE: !!process.env.FABRIC_SQL_DATABASE,
        AZURE_TENANT_ID: !!process.env.AZURE_TENANT_ID,
        AZURE_CLIENT_ID: !!process.env.AZURE_CLIENT_ID,
        AZURE_CLIENT_SECRET: !!process.env.AZURE_CLIENT_SECRET,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
        ADMIN_EMAILS: !!process.env.ADMIN_EMAILS,
      },
      // Echo the target so a wrong DB name is obvious (server host only, no creds).
      target: {
        server: process.env.FABRIC_SQL_SERVER || null,
        database: process.env.FABRIC_SQL_DATABASE || null,
      },
      db: { connect: false, tables: {}, error: null },
    };
    try {
      const pool = await getPool();
      out.db.connect = true;
      for (const t of ['bo_users', 'bo_games', 'bo_settings']) {
        try {
          const r = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.${t}`);
          out.db.tables[t] = r.recordset[0].n;
        } catch (e) {
          out.db.tables[t] = `ERROR: ${e.message}`;
        }
      }
      out.ok = out.db.connect && typeof out.db.tables.bo_users === 'number';
    } catch (err) {
      out.db.error = err.message;
      context.error('health db error:', err);
    }
    return { status: out.ok ? 200 : 500, jsonBody: out, headers: { 'Cache-Control': 'no-store' } };
  },
});
