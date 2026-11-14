import { buildInstructionMail } from './instruction-mail';

describe('buildInstructionMail', () => {
  const platformPassword = 'platform-smtp-password-should-not-appear';

  it('tells the person how to send from Gmail and does not include a platform password', () => {
    const mail = buildInstructionMail({
      firstName: 'Ada',
      companyEmail: 'ada@yadatechnology.com',
      login: 'ada@yadatechnology.com',
      password: 'generated-smtp-secret',
      smtpHost: 'smtp.mailgun.org',
    });

    expect(mail.subject).toContain('YADA DSOaaS');
    expect(mail.text).toContain('smtp.mailgun.org');
    expect(mail.text).toContain('Port: 587');
    expect(mail.text).toContain('Username: ada@yadatechnology.com');
    expect(mail.text).toContain('Password: generated-smtp-secret');
    expect(mail.text).toContain('ada@yadatechnology.com');
    expect(mail.text).toContain('24 hours');
    expect(mail.text).toContain('any address on the company domain');
    expect(mail.text).not.toContain(platformPassword);
    expect(mail.text).toContain('Those messages do not contain a password');
    expect(mail.text).toContain('verify the email address');
    expect(mail.text).toContain('set your password');
    expect(mail.html).toContain('cid:logo-light.png');
    expect(mail.html).toContain('Your email is ready');
    expect(mail.html).toContain('generated-smtp-secret');
    expect(mail.html).toContain('smtp.mailgun.org');
    expect(mail.html).not.toContain(platformPassword);
  });

  it('escapes the name and password in the html mail', () => {
    const mail = buildInstructionMail({
      firstName: 'Ada <script>',
      companyEmail: 'ada@yadatechnology.com',
      login: 'ada@yadatechnology.com',
      password: 'a&b<c>',
      smtpHost: 'smtp.mailgun.org',
    });

    expect(mail.html).toContain('Ada &lt;script&gt;');
    expect(mail.html).toContain('a&amp;b&lt;c&gt;');
    expect(mail.html).not.toContain('<script>');
  });
});
