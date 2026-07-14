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
require('./ref-claim/index');
require('./ac-overview/index');
require('./ac-actions/index');
require('./ac-results/index');
require('./ac-dip/index');
