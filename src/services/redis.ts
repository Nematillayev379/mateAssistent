import IORedis, { RedisOptions } from 'ioredis';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

export type RedisConnectionOptions = RedisOptions & { url?: string };
export interface RedisRuntimeConnection {
  readonly status: string;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

let redisConnection: IORedis | null = null;
let connectPromise: Promise<IORedis | null> | null = null;
let memoryConnection: RedisRuntimeConnection | null = null;

function getMemoryConnection(): RedisRuntimeConnection {
  if (memoryConnection) return memoryConnection;
  const store = new Map<string, { value: string; expiresAt: number }>();
  const ttlTimers = new Map<string, NodeJS.Timeout>();
  memoryConnection = {
    status: 'ready',
    async ping() { return 'PONG'; },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, { value, expiresAt: Infinity });
      return 'OK';
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) { removed += 1; }
        const t = ttlTimers.get(key);
        if (t) { clearTimeout(t); ttlTimers.delete(key); }
      }
      return removed;
    },
    async incr(key: string) {
      const entry = store.get(key);
      if (!entry || Date.now() > entry.expiresAt) {
        store.set(key, { value: '1', expiresAt: Infinity });
        return 1;
      }
      const next = parseInt(entry.value, 10) + 1;
      entry.value = String(next);
      return next;
    },
    async pexpire(key: string, ms: number) {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ms;
      const existing = ttlTimers.get(key);
      if (existing) clearTimeout(existing);
      ttlTimers.set(key, setTimeout(() => { store.delete(key); ttlTimers.delete(key); }, ms));
      return 1;
    },
  };
  return memoryConnection;
}

export function getRedisOptions(): RedisConnectionOptions | null {
  if (!CONFIG.REDIS_URL || CONFIG.REDIS_URL.trim() === '') {
    logger.info('REDIS_URL not configured - queue workers disabled, in-memory Redis fallback enabled');
    return null;
  }

  return {
    url: CONFIG.REDIS_URL,
    lazyConnect: true,
    connectTimeout: 10000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    autoResubscribe: false,
    autoResendUnfulfilledCommands: false,
    retryStrategy: (times: number) => {
      if (times > 3) {
        logger.error('Redis connection failed after 3 retries');
        return null;
      }
      return Math.min(times * 1000, 3000);
    }
  } as RedisConnectionOptions;
}

export async function getRedisConnection(): Promise<RedisRuntimeConnection | null> {
  const redisOptions = getRedisOptions();
  if (!redisOptions) return getMemoryConnection();

  if (!redisConnection) {
    try {
      redisConnection = new IORedis(redisOptions);

      redisConnection.on('error', (err) => {
        logger.error(`Redis connection error: ${err.message}`);
      });

      redisConnection.on('connect', () => {
        logger.info('Shared Redis connection established');
      });

      redisConnection.on('close', () => {
        logger.warn('Redis connection closed');
        redisConnection = null;
        connectPromise = null;
      });
    } catch (err: any) {
      logger.error(`Failed to create Redis connection: ${err.message}`);
      redisConnection = null;
      return null;
    }
  }

  if (redisConnection.status !== 'ready') {
    connectPromise ||= redisConnection.connect()
      .then(() => redisConnection)
      .catch((err: any) => {
        logger.error(`Redis connect failed: ${err.message}`);
        redisConnection = null;
        connectPromise = null;
        return null;
      });
    await connectPromise;
  }

  return redisConnection;
}

/** Alias for getRedisConnection */
export const getRedisClient = getRedisConnection;
