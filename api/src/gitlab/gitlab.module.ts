import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { GitLabService } from './gitlab.service';

@Module({
  imports: [HttpModule],
  providers: [GitLabService],
  exports: [GitLabService],
})
export class GitLabModule {}
