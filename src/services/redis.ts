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
}

let redisConnection: IORedis | null = null;
let connectPromise: Promise<IORedis | null> | null = null;
let memoryConnection: RedisRuntimeConnection | null = null;

function getMemoryConnection(): RedisRuntimeConnection {
  if (memoryConnection) return memoryConnection;
  const store = new Map<string, string>();
  memoryConnection = {
    status: 'ready',
    async ping() {
      return 'PONG';
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
      }
      return removed;
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
