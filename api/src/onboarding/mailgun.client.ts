import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { AppConfiguration } from '../config';

import { buildInstructionMail, INSTRUCTION_LOGO_CID } from './instruction-mail';
import { vendorError } from './http-error';
import type { InstructionMail, MailSenderPort, SmtpCredential } from './onboarding.ports';

@Injectable()
export class MailgunClient implements MailSenderPort {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  async createCredential(login: string): Promise<SmtpCredential> {
    const password = randomBytes(24).toString('base64url');
    await this.writeCredential(login, password);
    return { login, password };
  }

  async deleteCredential(login: string): Promise<void> {
    const { apiBase, domain, apiKey } = this.settings();
    try {
      await axios.delete(
        `${apiBase}/v3/domains/${encodeURIComponent(domain)}/credentials/${encodeURIComponent(login)}`,
        { auth: { username: 'api', password: apiKey } },
      );
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return;
      }
      throw vendorError(err, 'Mailgun delete credential');
    }
  }

  async sendInstructions(mail: InstructionMail): Promise<void> {
    const { apiBase, domain, apiKey, fromEmail, fromName } = this.settings();
    const content = buildInstructionMail({
      firstName: mail.firstName,
      companyEmail: mail.companyEmail,
      login: mail.login,
      password: mail.password,
      smtpHost: this.smtpHost(apiBase),
    });
    const body = new FormData();
    body.append('from', `${fromName} <${fromEmail}>`);
    body.append('to', mail.to);
    body.append('subject', content.subject);
    body.append('text', content.text);
    body.append('html', content.html);
    const logo = readFileSync(join(process.cwd(), 'assets', INSTRUCTION_LOGO_CID));
    body.append(
      'inline',
      new Blob([new Uint8Array(logo)], { type: 'image/png' }),
      INSTRUCTION_LOGO_CID,
    );
    try {
      await axios.post(`${apiBase}/v3/${encodeURIComponent(domain)}/messages`, body, {
        auth: { username: 'api', password: apiKey },
      });
    } catch (err) {
      throw vendorError(err, 'Mailgun send');
    }
  }

  private async writeCredential(login: string, password: string): Promise<void> {
    const { apiBase, domain, apiKey } = this.settings();
    const url = `${apiBase}/v3/domains/${encodeURIComponent(domain)}/credentials`;
    const body = new URLSearchParams({ login, password });
    const auth = { username: 'api', password: apiKey };
    try {
      await axios.post(url, body, {
        auth,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (err) {
      if (
        !axios.isAxiosError(err) ||
        (err.response?.status !== 400 && err.response?.status !== 409)
      ) {
        throw vendorError(err, 'Mailgun create credential');
      }
      await this.deleteCredential(login);
      try {
        await axios.post(url, new URLSearchParams({ login, password }), {
          auth,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch (retryErr) {
        throw vendorError(retryErr, 'Mailgun create credential');
      }
    }
  }

  private smtpHost(apiBase: string): string {
    return apiBase.includes('api.eu.mailgun.net') ? 'smtp.eu.mailgun.org' : 'smtp.mailgun.org';
  }

  private settings(): {
    apiBase: string;
    domain: string;
    apiKey: string;
    fromEmail: string;
    fromName: string;
  } {
    const apiKey = this.config.get('onboarding.mailgunApiKey', { infer: true });
    const domain = this.config.get('onboarding.mailgunDomain', { infer: true });
    const fromEmail = this.config.get('onboarding.smtpFromEmail', { infer: true });
    if (!apiKey || !domain || !fromEmail) {
      throw new Error('Set MAILGUN_API_KEY, MAILGUN_DOMAIN (or SMTP_DOMAIN), and SMTP_FROM_EMAIL');
    }
    return {
      apiKey,
      domain,
      apiBase: this.config.get('onboarding.mailgunApiBase', { infer: true }),
      fromEmail,
      fromName: this.config.get('onboarding.smtpFromName', { infer: true }),
    };
  }
}
