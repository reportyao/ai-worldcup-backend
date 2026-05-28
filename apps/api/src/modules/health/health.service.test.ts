import { describe, expect, it } from 'vitest';

import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('returns ok status with timestamp and version', () => {
    const svc = new HealthService();
    const snap = svc.snapshot();
    expect(snap.status).toBe('ok');
    expect(typeof snap.version).toBe('string');
    expect(typeof snap.timestamp).toBe('string');
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
