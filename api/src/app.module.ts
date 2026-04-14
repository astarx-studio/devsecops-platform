import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';

import { AppController } from './app.controller';
import { OidcJwtStrategy } from './common/guards';
import { AppConfigModule } from './config';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { ConfigsModule } from './configs/configs.module';
import { GitLabModule } from './gitlab/gitlab.module';
import { KongModule } from './kong/kong.module';
import { ProjectsModule } from './projects/projects.module';
import { TemplatesModule } from './templates/templates.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    AppConfigModule,
    PassportModule.register({ defaultStrategy: 'oidc-jwt' }),
    HttpModule,
    GitLabModule,
    KongModule,
    VaultModule,
    CloudflareModule,
    ConfigsModule,
    TemplatesModule,
    ProjectsModule,
  ],
  controllers: [AppController],
  providers: [OidcJwtStrategy],
})
export class AppModule {}
