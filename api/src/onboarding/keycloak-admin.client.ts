import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { AppConfiguration } from '../config';

import { vendorError } from './http-error';
import { companyUsername } from './onboarding.policy';
import type { IdentityInput, IdentityPort } from './onboarding.ports';

interface KeycloakUser {
  id: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

/** Admin API calls for realm devops using a confidential service account. */
@Injectable()
export class KeycloakAdminClient implements IdentityPort {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  async ensureUser(input: IdentityInput): Promise<{ id: string }> {
    const existing = await this.findByEmail(input.companyEmail);
    if (!existing) {
      return { id: await this.createUser(input) };
    }
    await this.updateUser(existing, input);
    return { id: existing.id };
  }

  async sendInvite(userId: string): Promise<void> {
    await this.sendAction(userId, 'send-verify-email');
    await this.sendAction(userId, 'execute-actions-email', ['UPDATE_PASSWORD']);
  }

  async disableUser(companyEmail: string): Promise<void> {
    const existing = await this.findByEmail(companyEmail);
    if (!existing) {
      return;
    }
    const { baseUrl, realm } = this.settings();
    try {
      await axios.put(
        `${baseUrl}/admin/realms/${realm}/users/${existing.id}`,
        { enabled: false },
        { headers: { Authorization: `Bearer ${await this.accessToken()}` } },
      );
    } catch (err) {
      throw vendorError(err, 'Keycloak disable user');
    }
  }

  private async sendAction(userId: string, path: string, actions?: string[]): Promise<void> {
    const { baseUrl, realm } = this.settings();
    try {
      await axios.put(`${baseUrl}/admin/realms/${realm}/users/${userId}/${path}`, actions, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
        params: { lifespan: 86400 },
      });
    } catch (err) {
      throw vendorError(err, 'Keycloak invite');
    }
  }

  private async findByEmail(email: string): Promise<KeycloakUser | undefined> {
    const { baseUrl, realm } = this.settings();
    try {
      const response = await axios.get<KeycloakUser[]>(`${baseUrl}/admin/realms/${realm}/users`, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
        params: { email, exact: true },
      });
      return response.data.find((user) => user.id);
    } catch (err) {
      throw vendorError(err, 'Keycloak find user');
    }
  }

  private async createUser(input: IdentityInput): Promise<string> {
    const { baseUrl, realm } = this.settings();
    try {
      const response = await axios.post(
        `${baseUrl}/admin/realms/${realm}/users`,
        this.userBody(input, true),
        {
          headers: { Authorization: `Bearer ${await this.accessToken()}` },
          validateStatus: (status) => status === 201 || status === 409,
        },
      );
      if (response.status === 409) {
        const existing = await this.findByEmail(input.companyEmail);
        if (!existing) {
          throw new Error('Keycloak create user failed: address already exists but was not found');
        }
        await this.updateUser(existing, input);
        return existing.id;
      }
      const location = response.headers.location as string | undefined;
      const id = location?.split('/').filter(Boolean).pop();
      if (!id) {
        throw new Error('Keycloak create user failed: response did not include a user id');
      }
      return id;
    } catch (err) {
      throw vendorError(err, 'Keycloak create user');
    }
  }

  private async updateUser(existing: KeycloakUser, input: IdentityInput): Promise<void> {
    const { baseUrl, realm } = this.settings();
    try {
      await axios.put(
        `${baseUrl}/admin/realms/${realm}/users/${existing.id}`,
        {
          ...this.userBody(input, true),
          attributes: {
            ...(existing.attributes ?? {}),
            personalEmail: [input.personalEmail],
          },
        },
        { headers: { Authorization: `Bearer ${await this.accessToken()}` } },
      );
    } catch (err) {
      throw vendorError(err, 'Keycloak update user');
    }
  }

  private userBody(input: IdentityInput, enabled: boolean) {
    return {
      username: companyUsername(input.companyEmail),
      email: input.companyEmail,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled,
      emailVerified: false,
      requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD'],
      attributes: { personalEmail: [input.personalEmail] },
    };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) {
      return this.token.value;
    }
    const { baseUrl, realm, clientId, clientSecret } = this.settings();
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await axios.post<{ access_token: string; expires_in?: number }>(
        `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
        body,
      );
      const expiresIn = response.data.expires_in ?? 60;
      this.token = {
        value: response.data.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      return this.token.value;
    } catch (err) {
      throw vendorError(err, 'Keycloak token');
    }
  }

  private settings(): {
    baseUrl: string;
    realm: string;
    clientId: string;
    clientSecret: string;
  } {
    const clientId = this.config.get('onboarding.keycloakClientId', { infer: true });
    const clientSecret = this.config.get('onboarding.keycloakClientSecret', { infer: true });
    if (!clientId || !clientSecret) {
      throw new Error(
        'Set KEYCLOAK_ONBOARDING_CLIENT_ID and KEYCLOAK_ONBOARDING_CLIENT_SECRET. Run bootstrap/patch-keycloak-onboarding.sh on an existing realm.',
      );
    }
    return {
      clientId,
      clientSecret,
      baseUrl: this.config.get('onboarding.keycloakBaseUrl', { infer: true }).replace(/\/$/, ''),
      realm: this.config.get('onboarding.keycloakRealm', { infer: true }),
    };
  }
}
