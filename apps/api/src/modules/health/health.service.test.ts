import { describe, expect, it } from 'vitest';

import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('returns degraded status with timestamp, version and skipped db when prisma is not injected', async () => {
    const svc = new HealthService();
    const snap = await svc.snapshot();

    expect(['ok', 'degraded']).toContain(snap.status);
    expect(typeof snap.version).toBe('string');
    expect(typeof snap.timestamp).toBe('string');
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(snap.dependencies.database.status).toBe('skipped');
    expect(['ok', 'error']).toContain(snap.dependencies.redis.status);
  });
});
