import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { CloudflareService } from './cloudflare.service';

@Module({
  imports: [HttpModule],
  providers: [CloudflareService],
  exports: [CloudflareService],
})
export class CloudflareModule {}
