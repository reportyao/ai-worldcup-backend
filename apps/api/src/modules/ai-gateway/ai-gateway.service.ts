import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateStructuredPrediction,
  type AiGatewayMatchContext,
  type AiGatewayModelConfig,
} from '@ai-worldcup/shared';
import type { PredictionVersion } from '@ai-worldcup/shared';

@Injectable()
export class AiGatewayService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  generate(
    model: AiGatewayModelConfig,
    match: AiGatewayMatchContext,
    version: PredictionVersion,
  ) {
    return generateStructuredPrediction(model, match, version, {
      timeoutMs: this.config.get<number>('AI_GATEWAY_TIMEOUT_MS') ?? 30_000,
      defaultBaseUrl: this.config.get<string>('AI_GATEWAY_BASE_URL'),
      openaiApiKey: this.config.get<string>('AI_OPENAI_API_KEY'),
      openaiBaseUrl: this.config.get<string>('AI_OPENAI_BASE_URL'),
      googleApiKey: this.config.get<string>('AI_GOOGLE_API_KEY'),
      googleBaseUrl: this.config.get<string>('AI_GOOGLE_BASE_URL'),
      anthropicApiKey: this.config.get<string>('AI_ANTHROPIC_API_KEY'),
      anthropicBaseUrl: this.config.get<string>('AI_ANTHROPIC_BASE_URL'),
      allowMock: this.config.get<boolean>('AI_ALLOW_MOCK') ?? false,
    });
  }
}
