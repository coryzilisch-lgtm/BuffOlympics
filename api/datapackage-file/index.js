const { app } = require('@azure/functions');
const { getPool } = require('../lib/db');
const { loadRosterBlock } = require('../lib/bootstrap');
const { RESOURCES, buildResourceRows, toCsv } = require('../lib/datapackage');

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET /api/datapackage-file?name=<resource> — one CSV resource of the public
// event-program data package (see /api/datapackage for the descriptor).
// Anonymous, read-only. Reads the SAME cached roster block bootstrap.js
// shares across every viewer (~120s TTL) — this never runs its own polling
// loop; it only touches the DB when a request actually comes in, and only
// pays for a fresh query batch if that shared cache happens to be cold.
app.http('datapackage-file', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'datapackage-file',
  handler: async (request, context) => {
    try {
      const name = (request.query.get('name') || '').trim().replace(/\.csv$/i, '');
      const resource = RESOURCES.find(r => r.name === name);
      if (!resource) {
        return { status: 404, jsonBody: { error: `Unknown resource. Valid names: ${RESOURCES.map(r => r.name).join(', ')}` }, headers: NO_STORE };
      }
      const pool = await getPool();
      const roster = await loadRosterBlock(pool);
      const rows = buildResourceRows(resource.name, roster);
      const csv = toCsv(rows, resource.fields);
      return {
        status: 200,
        body: csv,
        headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `inline; filename="${resource.name}.csv"` },
      };
    } catch (err) {
      context.error('datapackage-file error:', err);
      return { status: 500, jsonBody: { error: 'Internal server error' }, headers: NO_STORE };
    }
  },
});
