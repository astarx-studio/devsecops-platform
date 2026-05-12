import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { ApolloDriver } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { ApolloDriverConfig } from '@nestjs/apollo';

import { AppController } from './app.controller';
import { OidcJwtStrategy } from './common/guards';
import { AppConfigModule, AppConfiguration } from './config';
import { ConfigsModule } from './configs/configs.module';
import { GitLabModule } from './gitlab/gitlab.module';
import { K8sModule } from './k8s/k8s.module';
import { ProjectsModule } from './projects/projects.module';
import { TemplatesModule } from './templates/templates.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    AppConfigModule,
    PassportModule.register({ defaultStrategy: 'oidc-jwt' }),
    HttpModule,

    // MongoDB — v2 primary data store
    MongooseModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfiguration>) => ({
        uri: configService.get<string>('mongo.url', { infer: true })!,
        dbName: configService.get<string>('mongo.dbName', { infer: true })!,
      }),
    }),

    // GraphQL — code-first, Apollo Server v5
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfiguration>) => {
        const isProd = process.env.NODE_ENV === 'production';
        return {
          // Generate schema in-memory (code-first); use autoSchemaFile: 'schema.gql' for file output
          autoSchemaFile: true,
          sortSchema: true,
          // Disable introspection in production to reduce attack surface
          introspection: !isProd,
          // Apollo Sandbox landing page in non-prod
          playground: false,
          // Forward ConfigService to resolvers via context
          context: ({ req }: { req: unknown }) => ({ req }),
        };
      },
    }),

    GitLabModule,
    VaultModule,
    K8sModule,
    ConfigsModule,
    TemplatesModule,
    ProjectsModule,
  ],
  controllers: [AppController],
  providers: [OidcJwtStrategy],
})
export class AppModule {}
