const { app } = require("@azure/functions");
const { withSqlRetry } = require("../shared/db");
const { sendFeeReminder } = require("../shared/sendFeeRemainder");

/**
 * Azure Timer Trigger: Daily overdue fee reminders.
 *
 * Schedule: 09:00 AM IST (03:30 UTC).
 *
 * Required dbo.Students columns:
 * StudentID, Name, Course, TotalFee, PaidAmount, DueDate, Email
 *
 * Required Function App settings:
 * BREVO_API_KEY
 * BREVO_SENDER_EMAIL (must be verified in Brevo)
 * BREVO_SENDER_NAME (optional)
 */

function dateOnly(value) {
    if (!value) return "Not available";

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    return String(value).slice(0, 10);
}

app.timer("overdueFeeReminder", {
    // Azure Functions NCRONTAB: second minute hour day month day-of-week.
    // 03:30 UTC = 09:00 AM IST.
    schedule: "0 30 3 * * *",
    runOnStartup: false,
    useMonitor: true,

    handler: async (myTimer, context) => {
        const startedAt = Date.now();
        let overdueStudents = [];
        let emailsAcceptedByBrevo = 0;
        let emailsFailed = 0;
        let studentsWithoutEmail = 0;

        context.log("Overdue fee reminder job started.");

        if (myTimer?.isPastDue) {
            context.warn("The scheduled reminder execution is past due.");
        }

        try {
            // 1. Fetch overdue students from Azure SQL.
            const result = await withSqlRetry((pool) =>
                pool.request().query(`
                    SELECT
                        StudentID,
                        Name,
                        Course,
                        TotalFee,
                        PaidAmount,
                        DueDate,
                        Email,
                        (TotalFee - PaidAmount) AS OutstandingAmount
                    FROM dbo.Students
                    WHERE DueDate < CAST(GETDATE() AS DATE)
                      AND PaidAmount < TotalFee
                    ORDER BY DueDate ASC, StudentID ASC;
                `)
            );

            overdueStudents = result.recordset || [];

            context.log("Overdue fee query completed.", {
                overdueStudentCount: overdueStudents.length
            });

            // 2. Exit if no students have overdue fees.
            if (overdueStudents.length === 0) {
                context.log(
                    "No overdue fee payments found. No reminders required."
                );
                return;
            }

            // 3. Send individual reminders through Brevo.
            // A failure for one student will not stop other emails.
            for (const student of overdueStudents) {
                if (!student.Email || !String(student.Email).trim()) {
                    studentsWithoutEmail++;

                    context.warn(
                        "Reminder skipped: student has no email address.",
                        {
                            studentId: student.StudentID,
                            dueDate: dateOnly(student.DueDate)
                        }
                    );

                    continue;
                }

                try {
                    await sendFeeReminder(student);
                    emailsAcceptedByBrevo++;

                    context.log("Fee reminder accepted by Brevo.", {
                        studentId: student.StudentID
                    });
                } catch (error) {
                    emailsFailed++;

                    context.error("Fee reminder failed.", {
                        studentId: student.StudentID,
                        errorName: error?.name,
                        errorMessage: error?.message
                    });
                }
            }

            // 4. Log the final execution summary.
            const summary = {
                overdueStudentCount: overdueStudents.length,
                emailsAcceptedByBrevo,
                emailsFailed,
                studentsWithoutEmail,
                durationMs: Date.now() - startedAt
            };

            context.log("Overdue fee reminder job completed.", summary);

            if (emailsFailed > 0) {
                context.warn(
                    "Some reminder emails failed. Review Application Insights and Brevo transactional logs."
                );
            }
        } catch (error) {
            context.error("Overdue fee reminder job failed.", {
                errorName: error?.name,
                errorCode: error?.code,
                errorMessage: error?.message,
                durationMs: Date.now() - startedAt
            });

            // Let Azure Functions record the invocation as failed.
            throw error;
        }
    }
});