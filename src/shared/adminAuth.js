const { sql, withSqlRetry } = require("./db");
const { jsonResponse } = require("./http");

const OBJECT_ID_CLAIM_TYPES = new Set([
  "oid",
  "http://schemas.microsoft.com/identity/claims/objectidentifier"
]);

function getEntraObjectId(request) {
  const encodedPrincipal = request.headers.get("x-ms-client-principal");

  if (!encodedPrincipal) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedPrincipal, "base64").toString("utf8");
    const principal = JSON.parse(decoded);

    if (principal.auth_typ !== "aad" || !Array.isArray(principal.claims)) {
      return null;
    }

    const objectIdClaim = principal.claims.find(
      (claim) =>
        OBJECT_ID_CLAIM_TYPES.has(String(claim.typ).toLowerCase()) &&
        typeof claim.val === "string"
    );

    const objectId = objectIdClaim?.val;

    // Entra object IDs are GUIDs. Validate before sending to SQL.
    const guidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    return objectId && guidPattern.test(objectId) ? objectId : null;
  } catch {
    return null;
  }
}

async function authorizeAdmin(request, context) {
  const entraObjectId = getEntraObjectId(request);

  if (!entraObjectId) {
    return {
      authorized: false,
      response: jsonResponse(401, {
        error: "Authentication required. Sign in with Microsoft Entra ID."
      })
    };
  }

  try {
    const result = await withSqlRetry(async (pool) => {
      return pool
        .request()
        .input("EntraObjectID", sql.UniqueIdentifier, entraObjectId)
        .query(`
          SELECT TOP (1) AdminID, Role
          FROM dbo.Administrators
          WHERE EntraObjectID = @EntraObjectID;
        `);
    });

    const administrator = result.recordset[0];

    if (!administrator) {
      return {
        authorized: false,
        response: jsonResponse(403, {
          error: "You are not registered as an administrator."
        })
      };
    }

    const role = String(administrator.Role || "").trim().toLowerCase();

    if (role !== "admin" && role !== "administrator") {
      return {
        authorized: false,
        response: jsonResponse(403, {
          error: "Your account does not have permission to update fee records."
        })
      };
    }

    return {
      authorized: true,
      adminId: administrator.AdminID,
      entraObjectId
    };
  } catch (err) {
    // Do not log tokens, identity headers, or other authentication material.
    context.error("Administrator authorization lookup failed.", {
      message: err?.message,
      code: err?.code,
      number: err?.number
    });

    return {
      authorized: false,
      response: jsonResponse(500, {
        error: "Unable to verify administrator permissions right now."
      })
    };
  }
}

module.exports = { authorizeAdmin };