import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppLoggerService } from './common/logger/app-logger.service';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap(): Promise<void> {
  // Bootstrap-phase errors must stay visible: the AppLoggerService instance
  // keeps Nest's ExceptionsZone from silently exiting on init failures.
  const logger = new AppLoggerService();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
  });

  app.use(requestIdMiddleware);
  app.use(helmet());

  const config = app.get(ConfigService);
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins') ?? ['http://localhost:5173'],
    credentials: true,
  });

  app.use(cookieParser());

  app.setGlobalPrefix('api/v1', {
    // Health endpoints stay outside the versioned prefix: plain infra probes.
    exclude: ['health', 'health/live', 'health/ready'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('WCIES API')
    .setDescription('WCIES cross-border e-commerce management system API')
    .setVersion('0.1.0')
    .addCookieAuth('wcies_session')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Document paths must match real URLs. NestJS 11 already includes the
  // /api/v1 global prefix in document.paths; only patch paths that are
  // missing it (health* stays outside the prefix at runtime).
  {
    const apiPrefix = '/api/v1';
    const originalPaths = document.paths as unknown as Record<string, object>;
    const rewritten: Record<string, object> = {};
    for (const [path, item] of Object.entries(originalPaths)) {
      rewritten[
        path.startsWith('/health') || path.startsWith(apiPrefix) ? path : `${apiPrefix}${path}`
      ] = item;
    }
    (document as { paths: Record<string, object> }).paths = rewritten;
  }
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>('app.port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.info(`API listening on port ${port}`, { module: 'bootstrap', port });
}

void bootstrap();
