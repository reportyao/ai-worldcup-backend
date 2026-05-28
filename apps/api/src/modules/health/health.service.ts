import { Injectable } from '@nestjs/common';

export interface HealthSnapshot {
  status: 'ok';
  timestamp: string;
  version: string;
  uptimeSec: number;
}

@Injectable()
export class HealthService {
  private readonly version = process.env.APP_VERSION ?? '0.0.1';

  snapshot(): HealthSnapshot {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: this.version,
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
