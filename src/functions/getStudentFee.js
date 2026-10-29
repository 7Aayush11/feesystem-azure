const { app } = require("@azure/functions");
const { sql, withSqlRetry } = require("../shared/db");
const { jsonResponse, logSafeError } = require("../shared/http");

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function getStatus(student, today = new Date().toISOString().slice(0, 10)) {
  const total = Number(student.TotalFee);
  const paid = Number(student.PaidAmount);
  const dueDate = dateOnly(student.DueDate);

  if (paid >= total) return "Paid";
  if (dueDate < today) return "Overdue";
  if (paid > 0) return "Partially Paid";
  return "Pending";
}

app.http("getStudentFee", {
  methods: ["GET"],
  authLevel: "function",
  route: "students/{studentId:int}/fees",
  handler: async (request, context) => {
    const studentId = Number(request.params.studentId);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) {
      return jsonResponse(400, { error: "studentId must be a positive integer." });
    }

    try {
      const result = await withSqlRetry((pool) =>
        pool.request()
          .input("StudentID", sql.Int, studentId)
          .query(`
            SELECT StudentID, Name, Course, TotalFee, PaidAmount, DueDate, Email
            FROM dbo.Students
            WHERE StudentID = @StudentID;
          `)
      );

      if (result.recordset.length === 0) {
        return jsonResponse(404, { error: "Student not found." });
      }

      const student = result.recordset[0];
      const status = getStatus(student);
      context.log("Student fee record retrieved.", { studentId, status });

      return jsonResponse(200, {
        studentId: student.StudentID,
        name: student.Name,
        course: student.Course,
        totalFee: Number(student.TotalFee),
        paidAmount: Number(student.PaidAmount),
        outstandingAmount: Math.max(0, Number(student.TotalFee) - Number(student.PaidAmount)),
        dueDate: dateOnly(student.DueDate),
        status
      });
    } 
    catch (error) {
        context.error("Failed to retrieve student fee record.", error);

        context.error("Error details:", {
            name: error?.name,
            message: error?.message,
            code: error?.code,
            number: error?.number,
            stack: error?.stack
        });

        return {
            status: 500,
            jsonBody: {
                error: "Unable to retrieve fee details right now."
            }
        };
    }
  }
});
