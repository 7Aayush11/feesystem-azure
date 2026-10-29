function jsonResponse(status, body) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    jsonBody: body
  };
}

function logSafeError(context, message, err) {
  // Avoid logging credentials, SQL text, or full request bodies.
  context.error(message, {
    errorCode: err && err.code ? String(err.code) : "UNKNOWN",
    errorName: err && err.name ? String(err.name) : "Error"
  });
}

module.exports = { jsonResponse, logSafeError };
