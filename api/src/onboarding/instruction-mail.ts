/** Content-Id of the logo attached to the introduction mail. */
export const INSTRUCTION_LOGO_CID = 'logo-light.png';

export interface InstructionMailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Setup mail sent to the personal inbox.
 * The password argument is the new Mailgun SMTP password, never a Keycloak password.
 */
export function buildInstructionMail(input: {
  firstName: string;
  companyEmail: string;
  login: string;
  password: string;
  smtpHost: string;
}): InstructionMailContent {
  const subject = 'Your YADA DSOaaS email is ready';
  const text = [
    `Hello ${input.firstName},`,
    '',
    `Your sign-in address for YADA DSOaaS is ${input.companyEmail}.`,
    'Sign in with that address, not this personal one. There is no separate inbox.',
    `Mail sent to ${input.companyEmail} arrives in this inbox.`,
    '',
    '1. If a message asks you to confirm that this personal address may receive forwarded mail, open it before anything else. Check spam if it is missing. If you already confirmed it, skip this step.',
    '',
    '2. Two more messages will arrive in this inbox from YADA DSOaaS.',
    'One asks you to verify the email address. The other asks you to set your password.',
    'Each message has its own link. The links expire in 24 hours.',
    'Those messages do not contain a password.',
    '',
    `3. To send as ${input.companyEmail} from Gmail: Settings, See all settings, Accounts and Import, Send mail as, Add another email address.`,
    `Enter ${input.companyEmail}. Send mail through this SMTP server:`,
    `Host: ${input.smtpHost}`,
    'Port: 587',
    `Username: ${input.login}`,
    `Password: ${input.password}`,
    'Secured connection: TLS',
    `Gmail will send a confirmation code to ${input.companyEmail}. The code appears in this inbox.`,
    'This username can send as any address on the company domain. Do not share the password.',
    '',
    'If you do not use Gmail, ask the person who invited you for help with your mail app.',
    '',
  ].join('\n');

  return { subject, text, html: buildInstructionHtml(input) };
}

function buildInstructionHtml(input: {
  firstName: string;
  companyEmail: string;
  login: string;
  password: string;
  smtpHost: string;
}): string {
  const firstName = escapeHtml(input.firstName);
  const companyEmail = escapeHtml(input.companyEmail);
  const login = escapeHtml(input.login);
  const password = escapeHtml(input.password);
  const smtpHost = escapeHtml(input.smtpHost);
  const body = `
    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#128ea3;">Welcome</p>
    <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:700;color:#241c18;">Your email is ready</h1>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#241c18;">Hello ${firstName}. Sign in to YADA DSOaaS with the company address below, not this personal one. There is no separate inbox. Mail sent to that address arrives here.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#fff4e6;border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b5348;">Sign-in address</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#241c18;">${companyEmail}</p>
        </td>
      </tr>
    </table>
    ${step('1', 'Confirm forwarding', 'If a message asks you to confirm that this personal address may receive forwarded mail, open it before anything else. Check spam if it is missing. If you already confirmed it, skip this step.')}
    ${step('2', 'Confirm the account and set a password', 'Two more messages will arrive in this inbox. One asks you to verify the email address. The other asks you to set your password. Each link expires in 24 hours. Those messages do not contain a password.')}
    ${step('3', 'Send as the company address', `In Gmail: Settings, See all settings, Accounts and Import, Send mail as, Add another email address. Enter ${companyEmail}, then use this SMTP server.`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;background-color:#ffffff;border:1px solid #f0dcc8;border-radius:12px;">
      ${credentialRow('Host', smtpHost)}
      ${credentialRow('Port', '587')}
      ${credentialRow('Username', login)}
      ${credentialRow('Password', password, true)}
      ${credentialRow('Security', 'TLS')}
    </table>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#241c18;">Gmail will send a confirmation code to ${companyEmail}. The code appears in this inbox.</p>
    <p style="margin:0;padding:14px 16px;background-color:#fff4e6;border-radius:12px;font-size:14px;line-height:1.5;color:#3a2a12;">This username can send as any address on the company domain. Do not share the password. If you do not use Gmail, ask the person who invited you for help with your mail app.</p>
  `;
  return dawnEmail(
    'Your YADA DSOaaS sign-in address is ready, with steps to send mail as that address.',
    body,
  );
}

function step(number: string, title: string, copy: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
    <tr>
      <td width="36" valign="top" style="width:36px;padding-top:2px;">
        <div style="width:28px;height:28px;border-radius:14px;background-color:#128ea3;color:#ffffff;font-size:14px;font-weight:700;line-height:28px;text-align:center;">${number}</div>
      </td>
      <td valign="top" style="padding-left:8px;">
        <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#241c18;">${title}</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#241c18;">${copy}</p>
      </td>
    </tr>
  </table>`;
}

function credentialRow(label: string, value: string, secret = false): string {
  const valueStyle = secret
    ? 'font-family:Consolas,ui-monospace,monospace;font-size:14px;font-weight:700;color:#241c18;'
    : 'font-size:15px;font-weight:700;color:#241c18;';
  return `<tr>
    <td style="padding:10px 16px;border-bottom:1px solid #f0dcc8;font-size:13px;color:#6b5348;width:110px;">${label}</td>
    <td style="padding:10px 16px;border-bottom:1px solid #f0dcc8;${valueStyle}">${value}</td>
  </tr>`;
}

function dawnEmail(preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YADA DSOaaS</title>
</head>
<body style="margin:0;padding:0;background-color:#4c628f;background-image:linear-gradient(168deg,#24325c 0%,#4c628f 18%,#8b7396 36%,#d48784 54%,#f0a35a 74%,#f6d3a0 100%);font-family:Segoe UI,system-ui,sans-serif;color:#241c18;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#4c628f;background-image:linear-gradient(168deg,#24325c 0%,#4c628f 18%,#8b7396 36%,#d48784 54%,#f0a35a 74%,#f6d3a0 100%);">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#fffaf4;border-radius:16px;">
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:3px solid #e39a3c;">
              <img src="cid:${INSTRUCTION_LOGO_CID}" alt="" width="36" height="36" style="vertical-align:middle;border:0;border-radius:8px;">
              <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#128ea3;vertical-align:middle;margin-left:12px;">YADA DSOaaS</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 32px;">${body}</td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#fffaf4;">YADA DSOaaS</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
