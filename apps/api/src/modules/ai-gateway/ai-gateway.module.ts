import { Module } from '@nestjs/common';

import { AiGatewayService } from './ai-gateway.service.js';

@Module({
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
