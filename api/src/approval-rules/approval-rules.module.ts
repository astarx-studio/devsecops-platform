import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';

import { GitLabModule } from '../gitlab/gitlab.module';
import { AuditLog, AuditLogSchema } from '../projects/schemas/audit-log.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';

import { ApprovalRulesResolver } from './approval-rules.resolver';
import { ApprovalRulesService } from './approval-rules.service';

@Module({
  imports: [
    HttpModule,
    GitLabModule,
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [ApprovalRulesService, ApprovalRulesResolver],
})
export class ApprovalRulesModule {}
