import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { loadConfig } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api', { exclude: ['health'] });

  await app.listen(config.API_PORT, '0.0.0.0');
  const logger = new Logger('Bootstrap');
  logger.log(
    `AI Worldcup API listening on http://0.0.0.0:${config.API_PORT} (env=${config.NODE_ENV})`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] fatal error', err);
  process.exit(1);
});
