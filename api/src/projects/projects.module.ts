import { Module } from '@nestjs/common';

import { CloudflareModule } from '../cloudflare/cloudflare.module';
import { GitLabModule } from '../gitlab/gitlab.module';
import { KongModule } from '../kong/kong.module';
import { VaultModule } from '../vault/vault.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GitLabModule, KongModule, VaultModule, CloudflareModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
