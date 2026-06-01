import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

type BootstrapConfig = Pick<AppConfig, 'API_PORT' | 'NODE_ENV' | 'PUBLIC_BASE_URL' | 'H5_BASE_URL' | 'CORS_ALLOWED_ORIGINS'>;

function resolveCorsOrigin(config: BootstrapConfig) {
  if (config.NODE_ENV !== 'production') return true;

  const allowedOrigins = (config.CORS_ALLOWED_ORIGINS ?? `${config.PUBLIC_BASE_URL},${config.H5_BASE_URL}`)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const configService = app.get(ConfigService<AppConfig, true>);
  const config: BootstrapConfig = {
    API_PORT: configService.get('API_PORT', { infer: true }),
    NODE_ENV: configService.get('NODE_ENV', { infer: true }),
    PUBLIC_BASE_URL: configService.get('PUBLIC_BASE_URL', { infer: true }),
    H5_BASE_URL: configService.get('H5_BASE_URL', { infer: true }),
    CORS_ALLOWED_ORIGINS: configService.get('CORS_ALLOWED_ORIGINS', { infer: true }),
  };

  app.enableCors({
    origin: resolveCorsOrigin(config),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api', { exclude: ['health', 'api/health'] });

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
