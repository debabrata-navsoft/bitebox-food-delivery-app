import { escapeHtml } from "../utils/html.js";
import { sendMail } from "./mail.service.js";

/**
 * The one BiteBox email layout (the same as Django's apps/notifications/templates/emails/layout.*).
 *
 * Every email (sign-up and verification codes, links, password reset, notifications) is
 * `{ subject, title, lines?, name?, code?, actionLabel?, actionUrl?, note?, footer? }`: a title, a few
 * lines of text, and optionally a code, a button and small print. `renderEmail` returns
 * `{ subject, text, html }`; `sendEmail` sends it through mail.service (SMTP, or the log in
 * development).
 */
export const ACCOUNT_FOOTER = "You are getting this email because of your BiteBox account.";
const SIGN_OFF = "BiteBox, good food, boxed and delivered.";

export function renderEmail({
  subject,
  title,
  lines = [],
  name = "",
  code = "",
  actionLabel = "",
  actionUrl = "",
  note = "",
  footer = ACCOUNT_FOOTER,
}) {
  const text = [
    ...(name ? [`Hi ${name},`, ""] : []),
    title,
    ...lines.flatMap((line) => ["", line]),
    ...(code ? ["", `    ${code}`] : []),
    ...(actionUrl ? ["", `${actionLabel}: ${actionUrl}`] : []),
    ...(note ? ["", note] : []),
    "",
    "--",
    footer,
    SIGN_OFF,
  ].join("\n");

  const e = escapeHtml;
  const box = (inner, margin = "8px 0 18px") =>
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:${margin}"><tr>${inner}</tr></table>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f3f9;font-family:Arial,Helvetica,sans-serif;color:#1d1622">
<div style="display:none;max-height:0;overflow:hidden">${e(lines[0] ?? title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#2e1a3d;padding:20px 28px"><span style="font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:-0.3px">bite<span style="color:#ffb52e">box</span></span></td></tr>
<tr><td style="padding:28px 28px 8px;font-size:15px;line-height:1.6">
${name ? `<p style="margin:0 0 12px">Hi ${e(name)},</p>` : ""}
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#2e1a3d">${e(title)}</h1>
${lines.map((line) => `<p style="margin:0 0 14px">${e(line)}</p>`).join("")}
${code ? box(`<td style="background:#fff3dc;border:1px solid #ffe6b8;border-radius:12px;padding:14px 24px;font-size:30px;font-weight:bold;letter-spacing:8px;color:#2e1a3d">${e(code)}</td>`) : ""}
${
  actionUrl
    ? box(`<td style="border-radius:12px;background:#2e1a3d"><a href="${e(actionUrl)}" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">${e(actionLabel)}</a></td>`) +
      `<p style="margin:0 0 14px;font-size:12px;color:#6b6372">If the button does not work, open this link: <a href="${e(actionUrl)}" style="color:#6d557c;word-break:break-all">${e(actionUrl)}</a></p>`
    : ""
}
${note ? `<p style="margin:0 0 14px;font-size:13px;color:#6b6372">${e(note)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;line-height:1.5;color:#6b6372;border-top:1px solid #f2eaf7">${e(footer)}<br />${SIGN_OFF}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

export const sendEmail = (to, email) => sendMail({ to, ...renderEmail(email) });
