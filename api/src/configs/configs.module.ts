import { Module } from '@nestjs/common';

import { GitLabModule } from '../gitlab/gitlab.module';
import { ConfigsController } from './configs.controller';
import { ConfigsService } from './configs.service';

@Module({
  imports: [GitLabModule],
  controllers: [ConfigsController],
  providers: [ConfigsService],
  exports: [ConfigsService],
})
export class ConfigsModule {}
