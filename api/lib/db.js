const sql = require('mssql');

const config = {
  server: process.env.FABRIC_SQL_SERVER,
  database: process.env.FABRIC_SQL_DATABASE,
  authentication: {
    type: 'azure-active-directory-service-principal-secret',
    options: {
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      tenantId: process.env.AZURE_TENANT_ID,
    },
  },
  options: {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000,
  },
  // Keep warm function instances connected longer so low-traffic requests
  // don't keep re-paying the SP-token + TDS handshake. min stays 0 —
  // serverless instances can't reliably hold a floor of connections.
  pool: { max: 10, min: 0, idleTimeoutMillis: 300000 },
};

let _pool = null;

async function getPool() {
  if (_pool) return _pool;
  _pool = await sql.connect(config);
  return _pool;
}

module.exports = { getPool, sql };
