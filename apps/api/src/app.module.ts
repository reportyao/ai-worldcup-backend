import type {
  MiddlewareConsumer,
  NestModule} from '@nestjs/common';
import {
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
} from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { ResponseInterceptor } from './common/response.interceptor.js';
import { loadConfig } from './config/configuration.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EntitlementsModule } from './modules/entitlements/entitlements.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MatchesModule } from './modules/matches/matches.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { PredictionsModule } from './modules/predictions/predictions.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { ShareModule } from './modules/share/share.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => loadConfig()],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    HealthModule,
    AdminModule,
    AuthModule,
    MatchesModule,
    PredictionsModule,
    ReviewsModule,
    EntitlementsModule,
    PaymentsModule,
    ShareModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({ transform: true, whitelist: true }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
