import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { SonarQubeService } from './sonarqube.service';

@Module({
  imports: [HttpModule],
  providers: [SonarQubeService],
  exports: [SonarQubeService],
})
export class SonarQubeModule {}
