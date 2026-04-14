import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AppConfiguration } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.ms(),
            process.env.NODE_ENV === 'production'
              ? winston.format.json()
              : winston.format.combine(
                  winston.format.colorize(),
                  winston.format.printf(({ timestamp, level, message, context, ms }) => {
                    const ctx = typeof context === 'string' ? context : 'App';
                    const elapsed = typeof ms === 'string' ? ms : '';
                    return `${String(timestamp)} [${ctx}] ${String(level)}: ${String(message)} ${elapsed}`;
                  }),
                ),
          ),
          level: process.env.LOG_LEVEL ?? 'info',
        }),
      ],
    }),
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: process.env.CORS_CREDENTIALS === 'true',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('DevOps Platform — Management API')
    .setDescription('Orchestrates project provisioning across GitLab, Vault, Kong, and Cloudflare.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const configService = app.get(ConfigService<AppConfiguration>);
  const port = configService.get<number>('port') ?? 3000;
  const host = configService.get<string>('host') ?? '0.0.0.0';

  const logger = new Logger('Bootstrap');
  await app.listen(port, host);
  logger.log(`Management API listening on ${host}:${port}`);
  logger.log(`Swagger docs at http://${host}:${port}/api/docs`);
}

void bootstrap();
