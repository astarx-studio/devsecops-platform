import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ConfigsModule } from '../configs/configs.module';
import { GitLabModule } from '../gitlab/gitlab.module';
import { K8sModule } from '../k8s/k8s.module';
import { TemplatesModule } from '../templates/templates.module';
import { VaultModule } from '../vault/vault.module';
import { ProjectsResolver } from './graphql/projects.resolver';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { Project, ProjectSchema } from './schemas/project.schema';
import { SlugService } from './slug.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    GitLabModule,
    VaultModule,
    K8sModule,
    TemplatesModule,
    ConfigsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, SlugService, ProjectsResolver],
  exports: [ProjectsService],
})
export class ProjectsModule {}
