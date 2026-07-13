// Explicit entry point — SWA managed Functions discover handlers by
// require()ing this file ("main": "index.js" in package.json).
// One app.http() registration per module (SWA gotcha).
require('./health/index');
require('./auth/index');
require('./me/index');
require('./me-team/index');
require('./bootstrap/index');
require('./signups/index');
require('./dip/index');
require('./dip-vote/index');
require('./relay/index');
require('./scores/index');
require('./results/index');
require('./admin-overview/index');
require('./admin-actions/index');
require('./admin-results/index');
require('./admin-dip/index');
