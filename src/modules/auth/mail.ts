import nodemailer from "nodemailer";

export async function sendResetLink(email: string, token: string) {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) {
    return false;
  }
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD ?? "";
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  await transport.sendMail({
    from,
    to: email,
    subject: "Reset your Meridian password",
    text: `Open this link to choose a new password. It expires in 30 minutes.\n\n${link}\n`,
  });
  return true;
}
