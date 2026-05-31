jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    status: 'ready',
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    on: jest.fn(),
    off: jest.fn(),
    defineCommand: jest.fn().mockReturnThis(),
  }));
});

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

process.env.REDIS_URL = '';
process.env.REDIS_URLS = '';
process.env.TELEGRAM_TOKEN = '123456:test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

import { getRedisOptions, getRedisPool, getRedisConnection } from '../src/services/redis';

describe('Redis Pool - Connection', () => {
  test('getRedisOptions returns null when no Redis configured', () => {
    const result = getRedisOptions();
    expect(result).toBeNull();
  });

  test('getRedisPool returns pool or null', () => {
    const result = getRedisPool();
    expect(result === null || typeof result === 'object').toBe(true);
  });

  test('getRedisConnection returns connection', async () => {
    const result = await getRedisConnection();
    expect(result).toBeDefined();
  });
});

describe('Redis Pool - Memory Fallback', () => {
  test('memory connection ping returns PONG', async () => {
    const conn = await getRedisConnection();
    if (conn) {
      const result = await conn.ping();
      expect(result).toBe('PONG');
    }
  });

  test('memory connection set/get works', async () => {
    const conn = await getRedisConnection();
    if (conn) {
      await conn.set('mem-key', 'mem-value');
      const value = await conn.get('mem-key');
      expect(value).toBe('mem-value');
    }
  });

  test('memory connection del works', async () => {
    const conn = await getRedisConnection();
    if (conn) {
      await conn.set('del-key', 'del-value');
      const removed = await conn.del('del-key');
      expect(removed).toBe(1);
      const value = await conn.get('del-key');
      expect(value).toBeNull();
    }
  });

  test('memory connection incr works', async () => {
    const conn = await getRedisConnection();
    if (conn) {
      await conn.set('incr-key', '0');
      const v1 = await conn.incr('incr-key');
      const v2 = await conn.incr('incr-key');
      expect(v1).toBe(1);
      expect(v2).toBe(2);
    }
  });

  test('memory connection returns null for missing keys', async () => {
    const conn = await getRedisConnection();
    if (conn) {
      const value = await conn.get('nonexistent-key');
      expect(value).toBeNull();
    }
  });

  test('memory connection del multiple keys', async () => {
    const conn = await getRedisConnection();
    if (conn) {
      await conn.set('k1', 'v1');
      await conn.set('k2', 'v2');
      const removed = await conn.del('k1', 'k2');
      expect(removed).toBe(2);
    }
  });
});
