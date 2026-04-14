import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';

/**
 * Client for the Cloudflare API v4.
 *
 * Manages DNS records for dynamically provisioned projects.
 * All methods gracefully no-op if Cloudflare credentials are not configured,
 * allowing the platform to run without Cloudflare integration.
 */
@Injectable()
export class CloudflareService {
  private readonly logger = new Logger(CloudflareService.name);
  private readonly apiToken?: string;
  private readonly zoneId?: string;
  private readonly tunnelId?: string;
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.apiToken = configService.get<string>('cloudflare.apiToken', {
      infer: true,
    });
    this.zoneId = configService.get<string>('cloudflare.zoneId', {
      infer: true,
    });
    this.tunnelId = configService.get<string>('cloudflare.tunnelId', {
      infer: true,
    });

    if (!this.isConfigured()) {
      this.logger.warn('Cloudflare integration disabled: missing API token or zone ID');
    }
  }

  private isConfigured(): boolean {
    return !!(this.apiToken && this.zoneId);
  }

  private get headers() {
    return { Authorization: `Bearer ${this.apiToken}` };
  }

  /**
   * Creates a CNAME DNS record pointing the hostname to the Cloudflare tunnel.
   *
   * @param hostname - Full hostname (e.g. "webapp.acme.apps.yourdomain.com")
   * @returns true if created, false if skipped (not configured)
   */
  async addDnsRecord(hostname: string): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.debug(
        `Skipping DNS record creation for "${hostname}" (Cloudflare not configured)`,
      );
      return false;
    }

    this.logger.log(`Creating CNAME DNS record: ${hostname}`);

    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/zones/${this.zoneId}/dns_records`,
          {
            type: 'CNAME',
            name: hostname,
            content: `${this.tunnelId}.cfargotunnel.com`,
            proxied: true,
            ttl: 1,
          },
          { headers: this.headers },
        ),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to create DNS record for "${hostname}": ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Removes the DNS record for a hostname.
   *
   * @param hostname - Full hostname to remove
   * @returns true if removed, false if skipped or not found
   */
  async removeDnsRecord(hostname: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    this.logger.log(`Removing DNS record: ${hostname}`);

    try {
      const { data: listData } = await firstValueFrom(
        this.httpService.get<{ result?: { id: string }[] }>(
          `${this.baseUrl}/zones/${this.zoneId}/dns_records`,
          { headers: this.headers, params: { name: hostname, type: 'CNAME' } },
        ),
      );

      const records = listData?.result ?? [];
      for (const record of records) {
        await firstValueFrom(
          this.httpService.delete(`${this.baseUrl}/zones/${this.zoneId}/dns_records/${record.id}`, {
            headers: this.headers,
          }),
        );
      }

      return records.length > 0;
    } catch (error) {
      this.logger.warn(
        `Failed to remove DNS record for "${hostname}": ${(error as Error).message}`,
      );
      return false;
    }
  }
}
