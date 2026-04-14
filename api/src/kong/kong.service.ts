import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { AppConfiguration } from '../config';

/**
 * Client for the Kong Admin API.
 *
 * Creates and removes services/routes for dynamically provisioned projects.
 * Uses internal Docker DNS URL (http://kong:8001).
 */
@Injectable()
export class KongService {
  private readonly logger = new Logger(KongService.name);
  private readonly adminUrl: string;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.adminUrl = configService.get<string>('kong.adminUrl', {
      infer: true,
    })!;
  }

  /**
   * Creates a Kong service and its hostname-based route.
   *
   * @param name - Service name (e.g. "acme-webapp-service")
   * @param upstreamUrl - Backend URL (e.g. "http://localhost:3000")
   * @param hosts - Hostnames to route to this service
   * @returns Object with service name and registered hostnames
   */
  async registerService(
    name: string,
    upstreamUrl: string,
    hosts: string[],
  ): Promise<{ serviceName: string; hosts: string[] }> {
    this.logger.log(`Registering Kong service "${name}" -> ${upstreamUrl}`);

    await firstValueFrom(
      this.httpService.put(`${this.adminUrl}/services/${name}`, {
        name,
        url: upstreamUrl,
        connect_timeout: 10000,
        read_timeout: 60000,
        write_timeout: 60000,
        retries: 3,
      }),
    );

    const routeName = `${name}-route`;
    this.logger.log(`Registering Kong route "${routeName}" for hosts: ${hosts.join(', ')}`);

    await firstValueFrom(
      this.httpService.put(`${this.adminUrl}/services/${name}/routes/${routeName}`, {
        name: routeName,
        hosts,
        protocols: ['http', 'https'],
        strip_path: false,
        preserve_host: true,
      }),
    );

    return { serviceName: name, hosts };
  }

  /**
   * Removes a Kong service and all its routes.
   *
   * @param name - Service name to remove
   */
  async removeService(name: string): Promise<void> {
    this.logger.log(`Removing Kong service "${name}" and its routes`);

    try {
      const routeName = `${name}-route`;
      await firstValueFrom(
        this.httpService.delete(`${this.adminUrl}/services/${name}/routes/${routeName}`),
      );
    } catch (error) {
      this.logger.warn(`Failed to delete route for service "${name}": ${(error as Error).message}`);
    }

    try {
      await firstValueFrom(this.httpService.delete(`${this.adminUrl}/services/${name}`));
    } catch (error) {
      this.logger.warn(`Failed to delete service "${name}": ${(error as Error).message}`);
    }
  }
}
