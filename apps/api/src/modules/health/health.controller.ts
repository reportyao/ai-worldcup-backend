import { Controller, Get } from '@nestjs/common';

import type { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check() {
    return this.health.snapshot();
  }
}
