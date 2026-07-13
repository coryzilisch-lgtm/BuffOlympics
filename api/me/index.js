const { app } = require('@azure/functions');
const { json, requireUser, userToJson } = require('../lib/auth');

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: async (request, context) => {
    try {
      const user = await requireUser(request);
      if (!user) return json({ error: 'Not signed in' }, 401);
      return json({ user: userToJson(user) });
    } catch (err) {
      context.error('me error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
});
