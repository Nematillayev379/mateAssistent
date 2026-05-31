jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { checkRateLimit, checkCommandRateLimit } from '../src/services/rate_limiter';

describe('rate_limiter - General', () => {
  it('should allow first request', async () => {
    expect(await checkRateLimit(99999)).toBe(true);
  });

  it('should track request counts', async () => {
    const userId = 88888;
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkRateLimit(userId));
    }
    expect(results.every(r => r === true)).toBe(true);
  });

  it('should allow different users independently', async () => {
    expect(await checkRateLimit(77777)).toBe(true);
    expect(await checkRateLimit(66666)).toBe(true);
  });
});

describe('rate_limiter - Command Rate Limit', () => {
  it('should allow first command', async () => {
    expect(await checkCommandRateLimit(111111)).toBe(true);
  });

  it('should track command counts', async () => {
    const userId = 222222;
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await checkCommandRateLimit(userId));
    }
    expect(results.every(r => r === true)).toBe(true);
  });

  it('should allow different users for commands', async () => {
    expect(await checkCommandRateLimit(333333)).toBe(true);
    expect(await checkCommandRateLimit(444444)).toBe(true);
  });

  it('should block excessive commands from same user', async () => {
    const userId = 555555;
    for (let i = 0; i < 5; i++) {
      await checkCommandRateLimit(userId);
    }
    const blocked = await checkCommandRateLimit(userId);
    expect(blocked).toBe(false);
  });
});
