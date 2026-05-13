import IORedis from 'ioredis';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

let redisConnection: IORedis | null = null;

export function getRedisConnection() {
  if (!redisConnection) {
    if (!CONFIG.REDIS_URL || CONFIG.REDIS_URL.trim() === '') {
      return null;
    }
    
    redisConnection = new IORedis(CONFIG.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    
    redisConnection.on('error', (err) => {
      logger.error(`Redis connection error: ${err.message}`);
    });
    
    redisConnection.on('connect', () => {
      logger.info('✅ Shared Redis connection established');
    });
  }
  
  return redisConnection;
}
