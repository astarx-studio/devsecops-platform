import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';

/**
 * Client for the OpenBao HTTP API (KV v2 secrets engine, Vault-compatible).
 *
 * Manages per-project secret paths: create, read, write, and delete.
 * Uses internal Docker DNS URL (http://vault:8200) with X-Vault-Token header.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.baseUrl = configService.get<string>('vault.url', { infer: true })!;
    this.token = configService.get<string>('vault.token', { infer: true })!;
  }

  private get headers() {
    return { 'X-Vault-Token': this.token };
  }

  /**
   * Writes secrets to a KV v2 path under the default "secret" mount.
   *
   * @param path - Vault path (e.g. "projects/acme/webapp")
   * @param secrets - Key-value pairs to store
   */
  async writeSecrets(path: string, secrets: Record<string, string>): Promise<void> {
    this.logger.log(`Writing secrets to vault path: secret/data/${path}`);
    this.logger.debug(`Secret keys: ${Object.keys(secrets).join(', ')} (values redacted)`);

    await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl}/v1/secret/data/${path}`,
        { data: secrets },
        { headers: this.headers },
      ),
    );
  }

  /**
   * Pings the Vault/OpenBao instance by calling the sys/health endpoint.
   * Returns true when Vault is initialized, unsealed, and active.
   * Returns false (never throws) on any network or HTTP error.
   *
   * @returns true if Vault is healthy, false otherwise
   */
  async ping(): Promise<boolean> {
    try {
      // sys/health returns 200 when initialized + unsealed + active.
      // Non-200 responses (standby, sealed, etc.) surface as Axios errors.
      await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/v1/sys/health`, { headers: this.headers }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the latest KV v2 secret version at a path.
   *
   * @param path - Vault path (e.g. "projects/acme/webapp/sonar")
   * @returns Key-value pairs, or empty object when the path has no data
   */
  async readSecrets(path: string): Promise<Record<string, string>> {
    this.logger.debug(`Reading secrets from vault path: secret/data/${path}`);

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ data?: { data?: Record<string, string> } }>(
          `${this.baseUrl}/v1/secret/data/${path}`,
          { headers: this.headers },
        ),
      );
      return data?.data?.data ?? {};
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        return {};
      }
      this.logger.warn(`Failed to read vault path "${path}": ${(error as Error).message}`);
      return {};
    }
  }

  /**
   * Lists immediate child keys under a KV v2 metadata path (non-recursive).
   *
   * @see https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#list-secrets
   */
  async listMetadataKeys(path: string): Promise<string[]> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ data?: { keys?: string[] } }>(
          `${this.baseUrl}/v1/secret/metadata/${path}`,
          { headers: this.headers, params: { list: true } },
        ),
      );
      return data?.data?.keys ?? [];
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Deletes all versions of secrets at a single KV v2 path.
   *
   * @param path - Vault path to permanently delete
   * @returns true when metadata was deleted (or already absent)
   */
  async deleteSecrets(path: string): Promise<boolean> {
    this.logger.warn(`Deleting vault secrets at: secret/metadata/${path}`);

    try {
      await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/v1/secret/metadata/${path}`, {
          headers: this.headers,
        }),
      );
      return true;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        return true;
      }
      this.logger.warn(`Failed to delete vault path "${path}": ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Deletes a project secret tree: base path plus env paths (dev/stg/prod/sonar, etc.).
   *
   * KV v2 does not cascade — deleting `projects/foo` leaves `projects/foo/dev` intact.
   */
  async deleteSecretsTree(path: string): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    let deleted = 0;

    let childKeys: string[];
    try {
      childKeys = await this.listMetadataKeys(path);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Failed to list vault children under "${path}": ${message}`);
      errors.push(`${path}: list failed (${message})`);
      childKeys = [];
    }

    for (const key of childKeys) {
      const isFolder = key.endsWith('/');
      const segment = isFolder ? key.slice(0, -1) : key;
      const childPath = `${path}/${segment}`;

      if (isFolder) {
        const nested = await this.deleteSecretsTree(childPath);
        deleted += nested.deleted;
        errors.push(...nested.errors);
      } else if (await this.deleteSecrets(childPath)) {
        deleted++;
      } else {
        errors.push(childPath);
      }
    }

    if (await this.deleteSecrets(path)) {
      deleted++;
    } else {
      errors.push(path);
    }

    this.logger.log(
      `deleteSecretsTree: path="${path}" deleted=${deleted} errors=${errors.length}`,
    );
    return { deleted, errors };
  }
}
