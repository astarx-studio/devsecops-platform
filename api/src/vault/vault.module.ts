import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { VaultService } from './vault.service';

@Module({
  imports: [HttpModule],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
