jest.mock('../src/services/redis', () => ({
  getRedisClient: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { checkRateLimit } from '../src/services/rate_limiter';

describe('rate_limiter (memory fallback)', () => {
  beforeEach(async () => {
    const { checkRateLimit: reset } = await import('../src/services/rate_limiter');
  });

  it('should allow first request', async () => {
    expect(await checkRateLimit(999)).toBe(true);
  });

  it('should block after 20 requests within window', async () => {
    const userId = 888;
    for (let i = 0; i < 20; i++) {
      expect(await checkRateLimit(userId)).toBe(true);
    }
    expect(await checkRateLimit(userId)).toBe(false);
  });

  it('should allow new request for different user', async () => {
    for (let i = 0; i < 25; i++) await checkRateLimit(777);
    expect(await checkRateLimit(666)).toBe(true);
  });
});
