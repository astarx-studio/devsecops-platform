import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ConfigsModule } from '../configs/configs.module';
import { AuditLog, AuditLogSchema } from '../projects/schemas/audit-log.schema';
import { ProjectsModule } from '../projects/projects.module';
import { TemplatesModule } from '../templates/templates.module';
import { VaultModule } from '../vault/vault.module';
import { McpAccessKey, McpAccessKeySchema } from './mcp-access-key.schema';
import { McpAccessKeyService } from './mcp-access-key.service';
import { McpHttpServer } from './mcp-http.server';
import { McpResolver } from './mcp.resolver';
import { McpToolService } from './mcp-tools';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: McpAccessKey.name, schema: McpAccessKeySchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    ProjectsModule,
    TemplatesModule,
    ConfigsModule,
    VaultModule,
  ],
  providers: [McpAccessKeyService, McpToolService, McpHttpServer, McpResolver],
})
export class McpModule {}
