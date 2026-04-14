import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';

/**
 * Client for the Vault HTTP API (KV v2 secrets engine).
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
   * Deletes all versions of secrets at a KV v2 path.
   *
   * @param path - Vault path to permanently delete
   */
  async deleteSecrets(path: string): Promise<void> {
    this.logger.warn(`Deleting vault secrets at: secret/metadata/${path}`);

    try {
      await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/v1/secret/metadata/${path}`, {
          headers: this.headers,
        }),
      );
    } catch (error) {
      this.logger.warn(`Failed to delete vault path "${path}": ${(error as Error).message}`);
    }
  }
}
