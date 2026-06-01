import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from './configuration.js';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  restoreEnv();
});

describe('loadConfig', () => {
  it('falls back DIRECT_URL to DATABASE_URL when only DATABASE_URL is configured', () => {
    restoreEnv();
    const databaseUrl = 'postgresql://postgres:postgres@localhost:5432/ai_worldcup?schema=public';
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = databaseUrl;
    delete process.env.DIRECT_URL;

    const config = loadConfig();

    expect(config.DIRECT_URL).toBe(databaseUrl);
    expect(process.env.DIRECT_URL).toBe(databaseUrl);
  });
});
