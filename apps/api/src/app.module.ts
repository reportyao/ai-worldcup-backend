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
import { ActivityModule } from './modules/activity/activity.module.js';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module.js';
import { AiPkModule } from './modules/ai-pk/ai-pk.module.js';
import { PersonalityModule } from './modules/personality/personality.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ConsensusModule } from './modules/consensus/consensus.module.js';
import { EntitlementsModule } from './modules/entitlements/entitlements.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { MatchesModule } from './modules/matches/matches.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { PredictionPipelineModule } from './modules/prediction-pipeline/prediction-pipeline.module.js';
import { PredictionsModule } from './modules/predictions/predictions.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { ScorecardModule } from './modules/scorecard/scorecard.module.js';
import { ShareModule } from './modules/share/share.module.js';
import { TranslationModule } from './modules/translation/translation.module.js';
import { LindyPredictionModule } from './modules/lindy-prediction/lindy-prediction.module.js';
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
    AiGatewayModule,
    PredictionPipelineModule,
    HealthModule,
    AdminModule,
    ActivityModule,
    PersonalityModule,
    AiPkModule,
    AuthModule,
    MatchesModule,
    PredictionsModule,
    ReviewsModule,
    ConsensusModule,
    ScorecardModule,
    EntitlementsModule,
    InvitationsModule,
    PaymentsModule,
    ShareModule,
    TranslationModule,
    LindyPredictionModule,
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
