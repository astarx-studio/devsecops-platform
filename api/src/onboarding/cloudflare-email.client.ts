import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { AppConfiguration } from '../config';

import { VendorStatusError, vendorError } from './http-error';
import type { DestinationStatus, EmailRoutingPort, ForwardRule } from './onboarding.ports';

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result: T;
  result_info?: { total_pages?: number };
}

interface DestinationRow {
  id: string;
  email: string;
  verified?: string | null;
  status?: string;
}

interface RuleRow {
  id: string;
  enabled?: boolean;
  name?: string;
  matchers?: Array<{ type?: string; field?: string; value?: string }>;
  actions?: Array<{ type?: string; value?: string[] }>;
}

@Injectable()
export class CloudflareEmailClient implements EmailRoutingPort {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  async ensureDestination(personalEmail: string): Promise<DestinationStatus> {
    const { accountId, token } = this.settings();
    const email = personalEmail.trim().toLowerCase();
    const existing = await this.findDestination(accountId, token, email);
    if (existing) {
      return { id: existing.id, verified: this.isVerified(existing) };
    }

    try {
      const created = await this.request<DestinationRow>(
        token,
        'POST',
        `/accounts/${accountId}/email/routing/addresses`,
        { email },
      );
      return { id: created.id, verified: this.isVerified(created) };
    } catch (err) {
      const again = await this.findDestination(accountId, token, email);
      if (again) {
        return { id: again.id, verified: this.isVerified(again) };
      }
      throw err;
    }
  }

  async upsertForward(
    companyEmail: string,
    personalEmail: string,
    existingRuleId?: string,
  ): Promise<ForwardRule> {
    const { zoneId, token } = this.settings();
    const company = companyEmail.trim().toLowerCase();
    const personal = personalEmail.trim().toLowerCase();
    const body = this.ruleBody(company, personal);
    const ruleId = existingRuleId ?? (await this.findRuleId(zoneId, token, company));

    let saved: RuleRow;
    if (!ruleId) {
      saved = await this.request<RuleRow>(
        token,
        'POST',
        `/zones/${zoneId}/email/routing/rules`,
        body,
      );
    } else {
      try {
        saved = await this.request<RuleRow>(
          token,
          'PUT',
          `/zones/${zoneId}/email/routing/rules/${ruleId}`,
          body,
        );
      } catch (err) {
        if (err instanceof VendorStatusError && err.status === 404) {
          saved = await this.request<RuleRow>(
            token,
            'POST',
            `/zones/${zoneId}/email/routing/rules`,
            body,
          );
        } else {
          throw err;
        }
      }
    }

    const readBack = await this.request<RuleRow>(
      token,
      'GET',
      `/zones/${zoneId}/email/routing/rules/${saved.id}`,
    );
    return { id: readBack.id, enabled: readBack.enabled === true };
  }

  async deleteRule(ruleId: string): Promise<void> {
    const { zoneId, token } = this.settings();
    try {
      await this.request<unknown>(
        token,
        'DELETE',
        `/zones/${zoneId}/email/routing/rules/${ruleId}`,
      );
    } catch (err) {
      if (err instanceof VendorStatusError && err.status === 404) {
        return;
      }
      throw err;
    }
  }

  private settings(): { token: string; accountId: string; zoneId: string } {
    const token = this.config.get('onboarding.cloudflareEmailToken', { infer: true });
    const accountId = this.config.get('onboarding.cloudflareAccountId', { infer: true });
    const zoneId = this.config.get('onboarding.cloudflareZoneId', { infer: true });
    if (!token || !accountId || !zoneId) {
      throw new Error(
        'Set CLOUDFLARE_EMAIL_API_TOKEN, CLOUDFLARE_EMAIL_ACCOUNT_ID, and CLOUDFLARE_EMAIL_ZONE_ID',
      );
    }
    return { token, accountId, zoneId };
  }

  private isVerified(row: DestinationRow): boolean {
    if (row.status) {
      return row.status.toLowerCase() === 'verified';
    }
    return Boolean(row.verified);
  }

  private ruleBody(companyEmail: string, personalEmail: string) {
    return {
      name: companyEmail,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: companyEmail }],
      actions: [{ type: 'forward', value: [personalEmail] }],
    };
  }

  private async findDestination(
    accountId: string,
    token: string,
    email: string,
  ): Promise<DestinationRow | undefined> {
    const rows = await this.listPages<DestinationRow>(
      token,
      `/accounts/${accountId}/email/routing/addresses`,
    );
    return rows.find((row) => row.email?.toLowerCase() === email);
  }

  private async findRuleId(
    zoneId: string,
    token: string,
    companyEmail: string,
  ): Promise<string | undefined> {
    const rows = await this.listPages<RuleRow>(token, `/zones/${zoneId}/email/routing/rules`);
    return rows.find((row) =>
      row.matchers?.some(
        (matcher) =>
          matcher.type === 'literal' &&
          matcher.field === 'to' &&
          matcher.value?.toLowerCase() === companyEmail,
      ),
    )?.id;
  }

  private async listPages<T>(token: string, path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const envelope = await this.envelope<T[]>(token, 'GET', `${path}?page=${page}&per_page=50`);
      rows.push(...(envelope.result ?? []));
      const total = envelope.result_info?.total_pages ?? 1;
      if (page >= total || envelope.result.length === 0) {
        break;
      }
    }
    return rows;
  }

  private async request<T>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const envelope = await this.envelope<T>(token, method, path, body);
    return envelope.result;
  }

  private async envelope<T>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<CloudflareEnvelope<T>> {
    try {
      const response = await axios.request<CloudflareEnvelope<T>>({
        method,
        url: `https://api.cloudflare.com/client/v4${path}`,
        headers: { Authorization: `Bearer ${token}` },
        data: body,
        validateStatus: () => true,
      });
      if (!response.data?.success) {
        const errors = response.data?.errors ?? [];
        const detail =
          errors
            .map((item) => item.message)
            .filter((message): message is string => Boolean(message))
            .join('; ') || `HTTP ${response.status}`;
        throw new VendorStatusError(`Cloudflare email routing failed: ${detail}`, response.status);
      }
      return response.data;
    } catch (err) {
      if (err instanceof VendorStatusError) {
        throw err;
      }
      throw vendorError(err, 'Cloudflare email routing');
    }
  }
}
