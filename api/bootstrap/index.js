const { app } = require('@azure/functions');
const { getPool } = require('../lib/db');
const { json, requireUser } = require('../lib/auth');
const { buildBootstrap } = require('../lib/bootstrap');

app.http('bootstrap', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'bootstrap',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      const pool = await getPool();
      return json(await buildBootstrap(pool, user));
    } catch (err) {
      context.error('bootstrap error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
