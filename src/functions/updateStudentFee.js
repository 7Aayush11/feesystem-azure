const { app } = require("@azure/functions");
const { sql, withSqlRetry } = require("../shared/db");
const { jsonResponse, logSafeError } = require("../shared/http");
const { authorizeAdmin } = require("../shared/adminAuth");

app.http("updateStudentFee", {
  methods: ["PUT"],
  authLevel: "function",
  route: "students/{studentId:int}/fee-update",

  handler: async (request, context) => {
    // Verify the caller's authorization.
    const authorization = await authorizeAdmin(request, context);

    if (!authorization.authorized) {
      return authorization.response;
    }

    const studentId = Number(request.params.studentId);

    if (!Number.isSafeInteger(studentId) || studentId <= 0) {
      return jsonResponse(400, {
        error: "studentId must be a positive integer."
      });
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, {
        error: "Request body must be valid JSON."
      });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse(400, {
        error: "Request body must be a JSON object."
      });
    }

    const allowed = new Set(["paidAmount", "totalFee", "dueDate"]);
    const unknown = Object.keys(body).filter(
      (key) => !allowed.has(key)
    );

    if (unknown.length) {
      return jsonResponse(400, {
        error: `Unsupported field(s): ${unknown.join(", ")}. Allowed fields: paidAmount, totalFee, dueDate.`
      });
    }

    if (Object.keys(body).length === 0) {
      return jsonResponse(400, {
        error: "Provide at least one field to update."
      });
    }

    // paidAmount is the additional payment being recorded.
    // Zero is allowed for requests that only update other fields.
    if (
      body.paidAmount !== undefined &&
      (
        typeof body.paidAmount !== "number" ||
        !Number.isFinite(body.paidAmount) ||
        body.paidAmount < 0
      )
    ) {
      return jsonResponse(400, {
        error: "paidAmount must be a non-negative number."
      });
    }

    if (
      body.totalFee !== undefined &&
      (
        typeof body.totalFee !== "number" ||
        !Number.isFinite(body.totalFee) ||
        body.totalFee < 0
      )
    ) {
      return jsonResponse(400, {
        error: "totalFee must be a non-negative number."
      });
    }

    if (
      body.dueDate !== undefined &&
      (
        typeof body.dueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ||
        Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`)) ||
        new Date(`${body.dueDate}T00:00:00Z`)
          .toISOString().slice(0, 10) !== body.dueDate
      )
    ) {
      return jsonResponse(400, {
        error: "dueDate must be a valid date in YYYY-MM-DD format."
      });
    }

    try {
      const result = await withSqlRetry(async (pool) => {
        const transaction = new sql.Transaction(pool);

        await transaction.begin();

        try {
          // Lock the row while calculating the updated payment.
          // This prevents concurrent requests from overwriting each
          // other's payment updates.
          const currentResult = await new sql.Request(transaction)
            .input("StudentID", sql.Int, studentId)
            .query(`
              SELECT StudentID, TotalFee, PaidAmount
              FROM dbo.Students WITH (UPDLOCK, ROWLOCK)
              WHERE StudentID = @StudentID;
            `);

          if (!currentResult.recordset.length) {
            await transaction.rollback();
            return { notFound: true };
          }

          const current = currentResult.recordset[0];

          const currentTotal = Number(current.TotalFee);
          const currentPaid = Number(current.PaidAmount);

          // If totalFee is supplied, update the total fee.
          const nextTotal =
            body.totalFee !== undefined
              ? body.totalFee
              : currentTotal;

          // If paidAmount is supplied, add it to the amount already paid.
          // Otherwise, preserve the existing paid amount.
          const paymentReceived =
            body.paidAmount !== undefined
              ? body.paidAmount
              : 0;

          const nextPaid = currentPaid + paymentReceived;

          // Reject payments that exceed the total fee.
          if (nextPaid > nextTotal) {
            await transaction.rollback();

            return {
              validationError:
                "The payment would cause paidAmount to exceed totalFee.",
              currentPaid,
              paymentReceived,
              totalFee: nextTotal
            };
          }

          const update = new sql.Request(transaction)
            .input("StudentID", sql.Int, studentId)
            .input("TotalFee", sql.Decimal(12, 2), nextTotal)
            .input("PaidAmount", sql.Decimal(12, 2), nextPaid);

          let dueDateSql = "";

          if (body.dueDate !== undefined) {
            update.input("DueDate", sql.Date, body.dueDate);
            dueDateSql = ", DueDate = @DueDate";
          }

          await update.query(`
            UPDATE dbo.Students
            SET TotalFee = @TotalFee,
                PaidAmount = @PaidAmount,
                UpdatedAtUtc = SYSUTCDATETIME()
                ${dueDateSql}
            WHERE StudentID = @StudentID;
          `);

          await transaction.commit();

          return {
            updated: true,
            totalFee: nextTotal,
            paidAmount: nextPaid,
            paymentReceived,
            outstandingAmount: nextTotal - nextPaid
          };
        } catch (err) {
          try {
            await transaction.rollback();
          } catch {
            // Preserve the original error.
          }

          throw err;
        }
      });

      if (result.notFound) {
        return jsonResponse(404, {
          error: "Student not found."
        });
      }

      if (result.validationError) {
        return jsonResponse(400, {
          error: result.validationError,
          currentPaid: result.currentPaid,
          paymentReceived: result.paymentReceived,
          totalFee: result.totalFee
        });
      }

      context.log("Student fee record updated.", { studentId });

      return jsonResponse(200, {
        message: "Fee record updated successfully.",
        studentId,
        paymentReceived: result.paymentReceived,
        totalFee: result.totalFee,
        paidAmount: result.paidAmount,
        outstandingAmount: result.outstandingAmount
      });
    } catch (err) {
      logSafeError(
        context,
        "Failed to update student fee record.",
        err
      );

      return jsonResponse(500, {
        error: "Unable to update fee details right now."
      });
    }
  }
});