import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

import { VaultService } from './vault/vault.service';

/** Shape of the /health response body. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  mongo: 'ok' | 'down';
  vault: 'ok' | 'down';
}

@Controller()
export class AppController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly vaultService: VaultService,
  ) {}

  /**
   * Lightweight liveness + dependency check.
   *
   * Returns `{ status: 'ok', mongo: 'ok', vault: 'ok' }` when both MongoDB and Vault are reachable;
   * returns `{ status: 'degraded', ... }` with individual component flags when
   * either dependency is unhealthy. Vault ping has an implicit 1-second
   * timeout via the underlying Axios request timeout.
   */
  @Get('health')
  async getHealth(): Promise<HealthResponse> {
    const mongoOk = this.mongoConnection.readyState === ConnectionStates.connected;
    const vaultOk = await this.vaultService.ping().catch(() => false);

    return {
      status: mongoOk && vaultOk ? 'ok' : 'degraded',
      mongo: mongoOk ? 'ok' : 'down',
      vault: vaultOk ? 'ok' : 'down',
    };
  }
}
