import IORedis, { RedisOptions } from 'ioredis';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

export type RedisConnectionOptions = RedisOptions & { url?: string };

let redisConnection: IORedis | null = null;

export function getRedisOptions(): RedisConnectionOptions | null {
  if (!CONFIG.REDIS_URL || CONFIG.REDIS_URL.trim() === '') {
    logger.info('ℹ️ REDIS_URL not configured - Redis features disabled');
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

// BUG-113 Fix: Allow retry on connection failure
export function getRedisConnection(): IORedis | null {
  if (!redisConnection) {
    const redisOptions = getRedisOptions();
    if (!redisOptions) return null;

    try {
      redisConnection = new IORedis(redisOptions);

      redisConnection.on('error', (err) => {
        logger.error(`Redis connection error: ${err.message}`);
      });
      
      redisConnection.on('connect', () => {
        logger.info('✅ Shared Redis connection established');
      });

      // BUG-113 Fix: Reset connection on close so next call can retry
      redisConnection.on('close', () => {
        logger.warn('⚠️ Redis connection closed');
        redisConnection = null;
      });
      
      redisConnection.connect().catch((err: any) => {
        logger.error(`Redis connect failed: ${err.message}`);
        redisConnection = null;
      });
    } catch (err: any) {
      logger.error(`Failed to create Redis connection: ${err.message}`);
      redisConnection = null;
      return null;
    }
  }
  
  return redisConnection;
}
