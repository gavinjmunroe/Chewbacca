// Stub for email notifications — wire to Resend/SendGrid later
export async function sendNotificationEmail({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}) {
  // TODO: Wire to email provider (Resend recommended: npm install resend)
  // const resend = new Resend(process.env.RESEND_API_KEY);
  // await resend.emails.send({ from: 'EGATS <noreply@egats.com>', to, subject, html: body });
  if (process.env.NODE_ENV === "development") {
    console.log("[Email stub]", { to, subject, body });
  }
}
