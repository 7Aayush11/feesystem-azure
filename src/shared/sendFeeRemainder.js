const https = require("https");

/**
 * Escape values before inserting them into HTML.
 */
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return replacements[character];
    });
}

/**
 * Format a number as Indian Rupees.
 */
function formatCurrency(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        throw new Error("Fee amount is not a valid number.");
    }

    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2
    }).format(number);
}

/**
 * Send a transactional email using the Brevo API.
 *
 * Required environment variable:
 * BREVO_API_KEY
 */
function sendBrevoRequest(payload) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.BREVO_API_KEY;

        if (!apiKey) {
            reject(
                new Error("BREVO_API_KEY is not configured.")
            );
            return;
        }

        const body = JSON.stringify(payload);

        const request = https.request(
            {
                hostname: "api.brevo.com",
                path: "/v3/smtp/email",
                method: "POST",

                headers: {
                    accept: "application/json",
                    "api-key": apiKey,
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(body)
                }
            },

            (response) => {
                let responseBody = "";

                response.on("data", (chunk) => {
                    responseBody += chunk;
                });

                response.on("end", () => {
                    if (
                        response.statusCode >= 200 &&
                        response.statusCode < 300
                    ) {
                        resolve(responseBody);
                        return;
                    }

                    // Never include the API key in error messages.
                    reject(
                        new Error(
                            `Brevo API returned HTTP ${response.statusCode}: ` +
                            `${responseBody || "No response body"}`
                        )
                    );
                });
            }
        );

        request.on("error", reject);

        request.setTimeout(15000, () => {
            request.destroy(
                new Error("Brevo API request timed out.")
            );
        });

        request.write(body);
        request.end();
    });
}

/**
 * Send a fee reminder to an individual student.
 *
 * Expected student properties:
 * StudentID, Name, Course, TotalFee, PaidAmount,
 * OutstandingAmount, DueDate, Email
 */
async function sendFeeReminder(student) {
    const senderEmail = process.env.BREVO_SENDER_EMAIL;

    const senderName =
        process.env.BREVO_SENDER_NAME ||
        "Fee Management System";

    if (!senderEmail) {
        throw new Error(
            "BREVO_SENDER_EMAIL is not configured."
        );
    }

    if (!student?.Email || !String(student.Email).trim()) {
        throw new Error(
            `Student ${student?.StudentID ?? "unknown"} has no email address.`
        );
    }

    const totalFee = Number(student.TotalFee);
    const paidAmount = Number(student.PaidAmount);

    const outstandingAmount = Number(
        student.OutstandingAmount ??
        totalFee - paidAmount
    );

    if (
        !Number.isFinite(totalFee) ||
        !Number.isFinite(paidAmount) ||
        !Number.isFinite(outstandingAmount) ||
        outstandingAmount <= 0
    ) {
        throw new Error(
            `Student ${student.StudentID} has invalid fee amounts or no outstanding balance.`
        );
    }

    const studentName = String(student.Name || "Student");
    const course = String(student.Course || "N/A");

    const dueDate = student.DueDate
        ? new Date(student.DueDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              timeZone: "Asia/Kolkata"
          })
        : "Not available";

    // HTML version of the email.
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Fee Payment Reminder</title>
</head>

<body style="font-family:Arial,sans-serif;color:#222;line-height:1.6">
    <div style="max-width:600px;margin:auto;padding:24px">

        <h2 style="color:#1d4ed8">
            Fee Payment Reminder
        </h2>

        <p>Dear ${escapeHtml(studentName)},</p>

        <p>
            Our records indicate that your course fee payment
            is overdue. Please review the details below.
        </p>

        <table style="width:100%;border-collapse:collapse">

            <tr>
                <td style="padding:10px;border:1px solid #ddd">
                    Student ID
                </td>
                <td style="padding:10px;border:1px solid #ddd">
                    ${escapeHtml(student.StudentID)}
                </td>
            </tr>

            <tr>
                <td style="padding:10px;border:1px solid #ddd">
                    Course
                </td>
                <td style="padding:10px;border:1px solid #ddd">
                    ${escapeHtml(course)}
                </td>
            </tr>

            <tr>
                <td style="padding:10px;border:1px solid #ddd">
                    Total fee
                </td>
                <td style="padding:10px;border:1px solid #ddd">
                    ${formatCurrency(totalFee)}
                </td>
            </tr>

            <tr>
                <td style="padding:10px;border:1px solid #ddd">
                    Amount paid
                </td>
                <td style="padding:10px;border:1px solid #ddd">
                    ${formatCurrency(paidAmount)}
                </td>
            </tr>

            <tr>
                <td style="padding:10px;border:1px solid #ddd">
                    <strong>Outstanding amount</strong>
                </td>
                <td style="padding:10px;border:1px solid #ddd;color:#b91c1c">
                    <strong>
                        ${formatCurrency(outstandingAmount)}
                    </strong>
                </td>
            </tr>

            <tr>
                <td style="padding:10px;border:1px solid #ddd">
                    Due date
                </td>
                <td style="padding:10px;border:1px solid #ddd">
                    ${escapeHtml(dueDate)}
                </td>
            </tr>

        </table>

        <p>
            If you have already paid, please contact the fee
            administration office to confirm your payment.
        </p>

        <p>
            Regards,<br>
            <strong>Fee Management Team</strong>
        </p>

    </div>
</body>
</html>`;

    // Plain-text version for email clients that do not display HTML.
    const textContent = [
        `Dear ${studentName},`,
        "",
        "This is a reminder that your course fee payment is overdue.",
        `Student ID: ${student.StudentID}`,
        `Course: ${course}`,
        `Total fee: ${formatCurrency(totalFee)}`,
        `Amount paid: ${formatCurrency(paidAmount)}`,
        `Outstanding amount: ${formatCurrency(outstandingAmount)}`,
        `Due date: ${dueDate}`,
        "",
        "If you have already paid, please contact the fee administration office.",
        "",
        "Regards,",
        "Fee Management Team"
    ].join("\n");

    // Submit the email to Brevo.
    return sendBrevoRequest({
        sender: {
            name: senderName,
            email: senderEmail
        },

        to: [
            {
                email: String(student.Email).trim(),
                name: studentName
            }
        ],

        subject: "Fee Payment Reminder",
        textContent,
        htmlContent
    });
}

module.exports = {
    sendFeeReminder
};