# Azure Fee Management — Azure Functions

This project contains two Azure Functions (Node.js v4 programming model):

- `GET /api/students/{studentId}/fees`
- `PUT /api/admin/students/{studentId}/fees`

The functions use parameterized SQL queries and application settings for connection details. The update function supports `paidAmount`, `totalFee`, and `dueDate`.

## Important security note

Both functions currently use `authLevel: "function"`, so callers must supply an Azure Functions function key. This is a useful interim gate, not the final Entra ID/RBAC implementation. Before treating the admin API as production-ready, configure Microsoft Entra ID authentication and role authorization at the API Management layer (or App Service Authentication plus authorization logic), then test that a non-admin token is denied. Do not publish function keys in source control, browser code, or screenshots.

## Requirements

- Node.js 22 LTS
- Azure Functions Core Tools v4
- Azure CLI (for deployment)
- An existing Azure SQL Database and `dbo.Students` table

## Application settings

Set these in Function App > Settings > Environment variables (or Configuration, depending on portal view):

- `SQL_SERVER`: server FQDN, e.g. `your-server.database.windows.net` (no `tcp:` prefix)
- `SQL_DATABASE`: database name
- `SQL_USER`: SQL database user
- `SQL_PASSWORD`: SQL user's password
- `SQL_ENCRYPT`: `true`
- `SQL_TRUST_SERVER_CERTIFICATE`: `false`

Use a least-privileged SQL login for the application. Never put the real password in source files. A later hardening step can replace SQL authentication with a managed identity.

## Local run

1. Install Node.js 22 and Azure Functions Core Tools v4.
2. Copy `local.settings.example.json` to `local.settings.json`.
3. Replace placeholder settings with your values. For local development, `AzureWebJobsStorage` may need a local storage emulator or a real Azure Storage connection string.
4. Run:
   ```bash
   npm install
   func start
   ```
5. Use the function key shown by Core Tools if requested.

Example GET:
```bash
curl "http://localhost:7071/api/students/1/fees?code=YOUR_FUNCTION_KEY"
```

Example PUT:
```bash
curl -X PUT "http://localhost:7071/api/admin/students/1/fees?code=YOUR_FUNCTION_KEY" \
  -H "Content-Type: application/json" \
  -d '{"paidAmount":15000}'
```

## Deploy

From this folder, sign in and publish to the already-created Function App:
```bash
az login
npm install
func azure functionapp publish func-feesystem-dev-ci-app
```

If the Function App's name differs, replace it in the command. Configure the SQL settings in the Azure portal before testing the deployed endpoints.

## Test deployed endpoints

Function key can be passed using `?code=...` or the `x-functions-key` header. Prefer the header for manual testing. Do not share the key.

```bash
curl -H "x-functions-key: YOUR_FUNCTION_KEY" \
  "https://func-feesystem-dev-ci-app.azurewebsites.net/api/students/1/fees"
```

```bash
curl -X PUT \
  -H "x-functions-key: YOUR_FUNCTION_KEY" \
  -H "Content-Type: application/json" \
  -d '{"paidAmount":15000}' \
  "https://func-feesystem-dev-ci-app.azurewebsites.net/api/admin/students/1/fees"
```

## Status rules

- `Paid`: `PaidAmount >= TotalFee`
- `Overdue`: payment is not complete and `DueDate` is before today's UTC date
- `Partially Paid`: payment is greater than zero but incomplete and not overdue
- `Pending`: no payment has been made and the due date has not passed

The assignment names Paid, Partially Paid, and Overdue. `Pending` is included to describe an unpaid record that is not overdue yet.

## Troubleshooting

- SQL login/network errors: verify server/database/user/password app settings, SQL firewall, and that the SQL user has permissions on `dbo.Students`.
- `404`: check the student ID exists and the URL route is correct.
- `401` or `403`: include a valid function key.
- `500`: check Function App > Functions > Monitor and Application Insights logs. Never log credentials.
- Function App cannot start: verify Node.js runtime and that deployment included `package.json`, `host.json`, and `src/`.

## Production hardening still required

1. Configure Entra ID authentication and RBAC for admin requests through APIM.
2. Configure APIM subscription-key validation and rate limiting.
3. Consider managed identity for Azure SQL rather than a SQL password.
4. Add audit identity (administrator object ID) to update records if the schema is extended.
5. Verify SQL indexes and test performance with at least 5,000 rows.
