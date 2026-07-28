const { app } = require('@azure/functions');
const { json } = require('../lib/auth');
const { RESOURCES } = require('../lib/datapackage');

// GET /api/datapackage — the Frictionless Data / OKF "datapackage.json"
// descriptor for the public event program. Anonymous (this is meant to be
// shared): no DB access at all, just the static resource schema plus links to
// GET /api/datapackage-file?name=<resource>, which serves the actual rows.
app.http('datapackage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'datapackage',
  handler: async (request, context) => {
    try {
      const url = new URL(request.url);
      const base = `${url.protocol}//${url.host}`;
      const resources = RESOURCES.map(r => ({
        name: r.name,
        path: `${base}/api/datapackage-file?name=${r.name}`,
        profile: 'tabular-data-resource',
        format: 'csv',
        mediatype: 'text/csv',
        encoding: 'utf-8',
        description: r.description,
        schema: {
          fields: r.fields.map(({ name, type, description }) => ({ name, type, ...(description ? { description } : {}) })),
        },
      }));
      return json({
        profile: 'tabular-data-package',
        name: 'buff-olympics-program',
        title: 'Buff Olympics — The Herd Games — Event Program',
        description:
          'Public program data for Buff Olympics (August 14, 2026): the game catalog, time slots, ' +
          "bracket structure, the day's shared schedule, and relay legs. Does NOT include sign-ups, " +
          'participant rosters, Dip Off entries, ref assignments, or scores — team totals stay sealed ' +
          'until an admin reveals them at the Closing Ceremony.',
        licenses: [
          { name: 'CC-BY-4.0', path: 'https://creativecommons.org/licenses/by/4.0/', title: 'Creative Commons Attribution 4.0 International' },
        ],
        keywords: ['buff-olympics', 'herd-games', 'event-program', 'open-data'],
        resources,
      });
    } catch (err) {
      context.error('datapackage error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
