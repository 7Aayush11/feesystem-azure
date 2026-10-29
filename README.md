# Student Fee Management System

A serverless student fee management solution with APIs for retrieving
fee details and updating fee records, scheduled overdue-payment
reminders, administrator authorization, and application monitoring.

## Contents

-   [Overview](#overview)
-   [Architecture](#architecture)
-   [Features](#features)
-   [Technology Stack](#technology-stack)
-   [Database Setup and SQL Queries](#database-setup-and-sql-queries)
-   [API Reference](#api-reference)
-   [Reminder Automation](#reminder-automation)
-   [Configuration](#configuration)
-   [Deployment Guide](#deployment-guide)
-   [Testing and Scalability](#testing-and-scalability)
-   [Security Notes](#security-notes)
-   [Troubleshooting](#troubleshooting)

## Overview

The application stores student fee details in a relational database,
calculates payment status, exposes the functionality through an API
gateway, and sends email reminders to students whose fees are overdue.

> **Repository:** Add your GitHub repository URL here if you want it
> displayed in this section.

## Architecture

The architecture diagram is stored in the repository root. Keep the
image filename exactly as shown below.

![Student Fee Management System
Architecture](./azure_fee_management_architecture.png)

**Request and data flow**

1.  A client sends an HTTP request with the configured Microsoft Entra
    access token and, when required, an API Management subscription key.
2.  API Management routes the request to the appropriate HTTP-triggered
    function and applies its configured API policies.
3.  The fee API reads or updates records in the database.
4.  The scheduled reminder function queries overdue, unpaid student
    records and calls the configured email provider.
5.  Application Insights captures application telemetry and diagnostic
    information.

## Features

-   Retrieve fee details by `StudentID`.
-   Calculate outstanding balance and payment status.
-   Update fee records through an administrator-authorized endpoint.
-   Find overdue students on a timer schedule and send individual email
    reminders.
-   Expose HTTP APIs through API Management, with subscription and
    rate-limit behavior determined by its deployed policies.
-   Use Microsoft Entra authentication and application-level
    administrator validation.
-   Use a shared SQL retry helper and log reminder failures.
-   Monitor execution and failures with Application Insights.

## Technology Stack

-   **Runtime:** Node.js and Azure Functions
-   **Database:** Azure SQL Database
-   **API gateway:** Azure API Management
-   **Identity:** Microsoft Entra ID / Function App authentication
-   **Email:** Brevo transactional email API
-   **Monitoring:** Application Insights
-   **Language:** JavaScript

## Database Setup and SQL Queries

Run these statements in the target Azure SQL database using an
authorized SQL client. If the tables already exist, inspect their
definitions first and adapt the `CREATE TABLE` statements rather than
running duplicate schema creation.

### 1. Create the Students table

The reminder function uses `Email` in addition to the core assignment
fields.

``` sql
CREATE TABLE dbo.Students
(
    StudentID  INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_Students PRIMARY KEY,
    Name       NVARCHAR(150) NOT NULL,
    Course     NVARCHAR(150) NOT NULL,
    TotalFee   DECIMAL(12,2) NOT NULL,
    PaidAmount DECIMAL(12,2) NOT NULL
        CONSTRAINT DF_Students_PaidAmount DEFAULT (0),
    DueDate    DATE NOT NULL,
    Email      NVARCHAR(320) NULL,

    CONSTRAINT CK_Students_TotalFee_NonNegative
        CHECK (TotalFee >= 0),
    CONSTRAINT CK_Students_PaidAmount_NonNegative
        CHECK (PaidAmount >= 0),
    CONSTRAINT CK_Students_PaidNotAboveTotal
        CHECK (PaidAmount <= TotalFee)
);
```

### 2. Create the Administrators table

The application authorization helper must match the authenticated
Microsoft Entra user's Object ID to an administrator record. The column
below is named `EntraObjectId`; if the deployed helper uses a different
column name, use that exact name in the schema and queries.

``` sql
CREATE TABLE dbo.Administrators
(
    AdminID       INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_Administrators PRIMARY KEY,
    Name          NVARCHAR(150) NOT NULL,
    Role          NVARCHAR(50) NOT NULL,
    EntraObjectId NVARCHAR(100) NOT NULL,

    CONSTRAINT UQ_Administrators_EntraObjectId
        UNIQUE (EntraObjectId)
);
```

### 3. Insert sample student records

The following inserts 20 sample records. It intentionally uses
fictitious names and example email addresses. If you already have
records, this statement adds another 20 records; run it only when
appropriate.

``` sql
INSERT INTO dbo.Students
    (Name, Course, TotalFee, PaidAmount, DueDate, Email)
VALUES
    (N'Aarav Shah',       N'B.Tech Computer Engineering', 120000, 120000, '2026-08-15', N'aarav.shah@example.com'),
    (N'Ananya Mehta',     N'B.Tech Information Technology', 115000, 60000, '2026-09-01', N'ananya.mehta@example.com'),
    (N'Vihaan Patel',     N'B.Tech Artificial Intelligence', 125000, 25000, '2026-09-10', N'vihaan.patel@example.com'),
    (N'Isha Desai',       N'B.Tech Computer Engineering', 120000, 0, '2026-12-15', N'isha.desai@example.com'),
    (N'Arjun Rao',        N'B.Tech Information Technology', 115000, 115000, '2026-08-20', N'arjun.rao@example.com'),
    (N'Saanvi Joshi',     N'B.Tech Artificial Intelligence', 125000, 50000, '2026-10-01', N'saanvi.joshi@example.com'),
    (N'Aditya Nair',      N'B.Tech Data Science', 122000, 0, '2026-12-20', N'aditya.nair@example.com'),
    (N'Anika Kulkarni',   N'B.Tech Computer Engineering', 120000, 80000, '2026-09-20', N'anika.kulkarni@example.com'),
    (N'Kabir Shah',       N'B.Tech Data Science', 122000, 122000, '2026-08-25', N'kabir.shah@example.com'),
    (N'Mira Iyer',        N'B.Tech Information Technology', 115000, 30000, '2026-09-25', N'mira.iyer@example.com'),
    (N'Reyansh Gupta',    N'B.Tech Artificial Intelligence', 125000, 0, '2026-12-10', N'reyansh.gupta@example.com'),
    (N'Kiara Menon',      N'B.Tech Computer Engineering', 120000, 90000, '2026-10-05', N'kiara.menon@example.com'),
    (N'Atharv Shah',      N'B.Tech Data Science', 122000, 122000, '2026-08-30', N'atharv.shah@example.com'),
    (N'Riya Kapoor',      N'B.Tech Information Technology', 115000, 45000, '2026-09-05', N'riya.kapoor@example.com'),
    (N'Dhruv Verma',      N'B.Tech Artificial Intelligence', 125000, 0, '2026-12-18', N'dhruv.verma@example.com'),
    (N'Pari Chavan',      N'B.Tech Computer Engineering', 120000, 70000, '2026-09-12', N'pari.chavan@example.com'),
    (N'Vedant Rao',       N'B.Tech Data Science', 122000, 122000, '2026-08-12', N'vedant.rao@example.com'),
    (N'Navya Shetty',     N'B.Tech Information Technology', 115000, 20000, '2026-09-18', N'navya.shetty@example.com'),
    (N'Krish Malhotra',   N'B.Tech Artificial Intelligence', 125000, 0, '2026-12-22', N'krish.malhotra@example.com'),
    (N'Tara Fernandes',   N'B.Tech Computer Engineering', 120000, 40000, '2026-09-28', N'tara.fernandes@example.com');
```

### 4. Add an administrator record

Use the actual Object ID of the authorized Microsoft Entra user. Do not
use a display name or email address in place of the Object ID.

``` sql
INSERT INTO dbo.Administrators (Name, Role, EntraObjectId)
VALUES
    (N'Demo Administrator', N'Admin', N'<MICROSOFT-ENTRA-USER-OBJECT-ID>');
```

If the administrator already exists, update or verify the existing
record rather than inserting a duplicate. Do not publish real user
identifiers in a public repository.

### 5. Verify tables and sample data

``` sql
SELECT COUNT(*) AS TotalStudents
FROM dbo.Students;

SELECT TOP (20)
    StudentID, Name, Course, TotalFee, PaidAmount, DueDate, Email
FROM dbo.Students
ORDER BY StudentID;

SELECT AdminID, Name, Role
FROM dbo.Administrators;
```

### 6. Find overdue students

This uses the same key criteria as the reminder query: the due date has
passed and the amount paid is below the total fee.

``` sql
SELECT
    StudentID,
    Name,
    Course,
    TotalFee,
    PaidAmount,
    TotalFee - PaidAmount AS OutstandingAmount,
    DueDate,
    Email
FROM dbo.Students
WHERE DueDate < CAST(GETDATE() AS DATE)
  AND PaidAmount < TotalFee
ORDER BY DueDate ASC, StudentID ASC;
```

### 7. Check and add a useful index

`StudentID` should be the primary key or have a unique index. Do not add
another index if an equivalent one already exists.

``` sql
-- Inspect indexes on dbo.Students.
SELECT
    i.name AS IndexName,
    i.type_desc AS IndexType,
    i.is_primary_key AS IsPrimaryKey,
    c.name AS ColumnName,
    ic.key_ordinal AS KeyOrdinal
FROM sys.indexes AS i
JOIN sys.index_columns AS ic
    ON ic.object_id = i.object_id
   AND ic.index_id = i.index_id
JOIN sys.columns AS c
    ON c.object_id = ic.object_id
   AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(N'dbo.Students')
ORDER BY i.name, ic.key_ordinal;
```

If execution-plan/metric evidence shows that the overdue query needs a
supporting index, a candidate is:

``` sql
CREATE INDEX IX_Students_DueDate
ON dbo.Students (DueDate)
INCLUDE (StudentID, TotalFee, PaidAmount, Name, Course, Email);
```

Create this only if an equivalent index does not already exist and the
query plan justifies it.

### 8. Check data quality

``` sql
-- Invalid fee values (expected: no rows).
SELECT StudentID, TotalFee, PaidAmount
FROM dbo.Students
WHERE TotalFee < 0
   OR PaidAmount < 0
   OR PaidAmount > TotalFee;

-- Duplicate StudentIDs (expected: no rows).
SELECT StudentID, COUNT(*) AS DuplicateCount
FROM dbo.Students
GROUP BY StudentID
HAVING COUNT(*) > 1;
```

> **Existing database warning:** These schema statements are a reference
> setup for a new database. Your deployed database may already have
> constraints, additional columns, or a different administrator
> identity-column name. Inspect the live schema and the
> `shared/adminAuth.js` query before applying them. Do not drop or
> recreate a database containing data you need.

## API Reference

The following paths are relative to the configured API Management API
base URL.

### Get fee details

``` http
GET /api/students/{studentId}/fees
```

Returns student details, total fee, amount paid, outstanding balance,
due date, and calculated status.

**Example**

``` bash
curl -X GET \
  "https://<APIM-HOST>/<API-BASE-PATH>/api/students/17/fees" \
  -H "Authorization: Bearer <MICROSOFT-ENTRA-ACCESS-TOKEN>" \
  -H "Ocp-Apim-Subscription-Key: <APIM-SUBSCRIPTION-KEY>"
```

**Illustrative response**

``` json
{
  "studentId": 17,
  "name": "Example Student",
  "course": "B.Tech",
  "totalFee": 100000,
  "paidAmount": 40000,
  "outstandingAmount": 60000,
  "dueDate": "2026-11-15",
  "status": "Partially Paid"
}
```

Possible statuses include `Paid`, `Partially Paid`, and `Overdue`; the
current implementation can also return `Pending` for unpaid records
whose due date has not passed.

### Update a fee record

``` http
PUT /api/students/{studentId}/fee-update
```

Supported request fields in the implementation include `paidAmount`,
`totalFee`, and `dueDate`.

``` bash
curl -X PUT \
  "https://<APIM-HOST>/<API-BASE-PATH>/api/students/17/fee-update" \
  -H "Authorization: Bearer <MICROSOFT-ENTRA-ACCESS-TOKEN>" \
  -H "Ocp-Apim-Subscription-Key: <APIM-SUBSCRIPTION-KEY>" \
  -H "Content-Type: application/json" \
  -d '{"paidAmount": 2000}'
```

**Important:** Verify the deployed function's payment semantics before
using this example. Depending on the deployed version, `paidAmount` can
be interpreted as a cumulative value or as an additional payment.
Repeating an incremental payment request can double-count it unless
idempotency is implemented.

A subscription key is not a replacement for user authentication or
authorization. The real APIM host and API base path should be taken from
your deployment configuration.

## Reminder Automation

The `overdueFeeReminder` timer-triggered function:

1.  Queries students whose `DueDate` is earlier than the current date
    and whose `PaidAmount` is below `TotalFee`.
2.  Sends an individual reminder using the configured Brevo
    transactional email helper.
3.  Logs accepted and failed attempts.

The intended daily schedule is `0 30 3 * * *` (03:30 UTC, equivalent to
09:00 India Standard Time). Verify the schedule in the deployed
function, especially if a faster interval was temporarily used for
testing.

Configure these Function App settings:

  Setting                Purpose
  ---------------------- -------------------------
  `BREVO_API_KEY`        Brevo API key; secret
  `BREVO_SENDER_EMAIL`   Verified sender address
  `BREVO_SENDER_NAME`    Sender display name

Never place real keys in this README or commit them to Git. Provider
acceptance does not guarantee delivery to the recipient's inbox; check
provider transactional logs and the mailbox.

## Configuration

Set the database connection/authentication configuration expected by the
repository's shared database module. Use the actual setting names in
`shared/db.js` and the deployed Function App configuration.

For email reminders, configure the three Brevo settings listed above.
Ensure Function App authentication and the Microsoft Entra app
registration/token audience match the deployed configuration. The
administrator identity stored in the database must match the identity
field read by `shared/adminAuth.js`.

Do not put credentials in source code, screenshots, README examples, or
Git history. Use Azure application settings or a managed secret store
and grant the Function App identity only the permissions it needs.

## Deployment Guide

Prerequisites:

-   Node.js version matching the Function App runtime.
-   npm.
-   Azure CLI.
-   Azure Functions Core Tools.
-   An Azure subscription and permission to configure the resources.
-   Access to the target SQL database.
-   A Brevo account, API key, and verified sender address.

1.  **Clone the repository and enter the project root.**

    ``` bash
    git clone <YOUR-GITHUB-REPOSITORY-URL>
    cd <YOUR-REPOSITORY-DIRECTORY>
    ```

2.  **Install dependencies.**

    ``` bash
    npm install
    ```

3.  **Check the project structure.** Confirm that `host.json`,
    `package.json`, function entry points, `shared/` modules, and any
    database scripts are present in the expected locations.

4.  **Prepare the database.** Create or verify the tables using the SQL
    section above. Confirm the administrator mapping matches the
    deployed authorization helper. Confirm the student count with
    `SELECT COUNT(*) FROM dbo.Students;`.

5.  **Configure the Function App.** Set database/authentication and
    Brevo application settings in the deployment environment. Never
    commit their values.

6.  **Verify identity and API gateway settings.** Confirm Function App
    authentication, administrator authorization, APIM operation routes,
    backend URL, subscription requirement, and rate-limit policy.

7.  **Sign in and publish.**

    ``` bash
    az login
    func azure functionapp publish <FUNCTION-APP-NAME>
    ```

    Run the command from the project root. Verify that all expected
    functions are discovered after publishing.

8.  **Test the APIs and timer.** Test successful and invalid GET calls,
    authorized and unauthorized PUT calls, APIM rate limiting, and a
    controlled overdue reminder. Inspect application logs and
    Application Insights.

9.  **Verify the schedule.** Confirm that the deployed timer uses the
    intended production schedule rather than a temporary test interval.

These are deployment steps; actual resource creation and configuration
must match the target environment. Replace placeholders with your
repository and resource values.

## Testing and Scalability

The requirement to store at least 5,000 student records is different
from handling 5,000 requests. Validate each separately.

-   Confirm the actual row count in `dbo.Students`.
-   Ensure `StudentID` is indexed appropriately.
-   Test the fee lookup and overdue query with representative data.
-   For a request-load test, record total requests, concurrency,
    throughput, latency percentiles, status codes, throttling, and
    failures.
-   Review Function App metrics, SQL metrics, APIM responses, and
    Application Insights telemetry.
-   Consider scaling service tiers only when measured data shows a
    capacity or latency bottleneck.

Do not claim that a 5,000-request load test has passed unless it has
actually been run.

## Security Notes

-   The administrator update endpoint performs application-level
    authorization against `dbo.Administrators`.
-   Verify the deployed APIM rate-limit policy; do not assume a specific
    threshold.
-   Ensure direct Function App access cannot bypass required
    protections.
-   The current GET implementation fetches by `StudentID` but does not
    itself establish that a non-admin caller owns that record. For
    student self-service in production, map the authenticated student
    identity to a trusted `StudentID` and restrict access to that
    student's record.
-   Use parameterized SQL and least-privilege database permissions.
-   Do not commit access tokens, database credentials, or email API
    keys.
-   Use payment transaction IDs/idempotency if update requests can be
    retried.

## Troubleshooting

  -----------------------------------------------------------------------
  Problem                             Checks
  ----------------------------------- -----------------------------------
  No functions discovered after       Publish from the project root;
  deployment                          inspect `host.json`,
                                      `package.json`, `.funcignore`,
                                      function registrations, imports,
                                      and startup logs.

  Brevo returns `401`                 Verify the API key type, validity,
                                      and Function App setting. Do not
                                      log the key.

  API returns `401` or `403`          Check Entra token audience/issuer,
                                      Function App authentication, APIM
                                      subscription key, and administrator
                                      identity mapping.

  API returns `429`                   Review the configured APIM
                                      rate-limit policy and its
                                      window/threshold.

  API returns `500`                   Inspect Application Insights
                                      exceptions, SQL connectivity, and
                                      database permissions.

  Reminder not received               Check timer schedule, overdue query
                                      results, verified sender, Brevo
                                      transactional logs, and recipient
                                      spam/quarantine folders.
  -----------------------------------------------------------------------

## Known Limitations and Future Improvements

-   Enforce student ownership for GET if student self-service access is
    required.
-   Add payment transaction IDs/idempotency for safe payment retries.
-   Track reminder history to avoid repeated reminders if that is
    required by the workflow.
-   Consider queue-based email processing if measured throughput or
    reliability needs justify it.
-   Configure alerts for recurring API, SQL, timer, and email failures.