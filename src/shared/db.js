const sql = require("mssql");

let poolPromise;

function getSqlConfig() {
  const required = ["SQL_SERVER", "SQL_DATABASE"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(
      `Missing required application settings: ${missing.join(", ")}`
    );
  }

  return {
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,

    options: {
      encrypt: true,
      trustServerCertificate: false
    },

    // Authenticate using Microsoft Entra ID.
    // In Azure, this uses the Function App's managed identity.
    authentication: {
      type: "azure-active-directory-default",
      options: {}
    },

    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    },

    connectionTimeout: 30000,
    requestTimeout: 30000
  };
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(getSqlConfig())
      .connect()
      .catch((err) => {
        poolPromise = undefined;
        throw err;
      });
  }

  return poolPromise;
}

function isTransientSqlError(err) {
  const codes = new Set([
    "ETIMEOUT",
    "ESOCKET",
    "ECONNCLOSED",
    "ECONNRESET",
    "ENOTOPEN",
    "ELOGIN",
    "EINSTLOOKUP"
  ]);

  return codes.has(err?.code);
}

async function withSqlRetry(operation, attempts = 3) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const pool = await getPool();
      return await operation(pool);
    } catch (err) {
      lastError = err;

      if (!isTransientSqlError(err) || attempt === attempts - 1) {
        if (isTransientSqlError(err)) {
          poolPromise = undefined;
        }

        throw err;
      }

      poolPromise = undefined;

      await new Promise((resolve) =>
        setTimeout(resolve, 250 * (2 ** attempt))
      );
    }
  }

  throw lastError;
}

module.exports = { sql, withSqlRetry };