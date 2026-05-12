import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

let _redisAvailable = false;
let scraperQueue: any = null;
let aiQueue: any = null;

function tryInitRedis() {
  const redisUrl = CONFIG.REDIS_URL;
  if (!redisUrl || redisUrl.trim() === '') {
    logger.warn('⚠️ REDIS_URL not set — queue disabled, using direct processing');
    return;
  }
  try {
    const { Queue } = require('bullmq');
    const IORedis = require('ioredis');
    const conn = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 5000,
    });
    conn.on('error', (err: Error) => {
      if (_redisAvailable) {
        logger.warn(`⚠️ Redis connection error: ${err.message} — switching to direct processing`);
      }
      _redisAvailable = false;
    });
    conn.on('ready', () => {
      logger.info('✅ Redis connected — queue mode active');
      _redisAvailable = true;
    });
    scraperQueue = new Queue('scraper-queue', { connection: conn });
    aiQueue = new Queue('ai-queue', { connection: conn });
    conn.connect().then(() => { _redisAvailable = true; }).catch(() => {
      _redisAvailable = false;
    });
  } catch (err: any) {
    logger.warn(`⚠️ Failed to init Redis: ${err.message} — using direct processing`);
    _redisAvailable = false;
  }
}

tryInitRedis();

export function isRedisAvailable(): boolean {
  return _redisAvailable;
}

export async function addScraperJob(data: any): Promise<void> {
  if (!_redisAvailable || !scraperQueue) {
    logger.debug('Queue not available — caller should use direct processing');
    return;
  }
  try {
    await scraperQueue.add('scrape-rss', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  } catch (err: any) {
    logger.warn(`addScraperJob failed: ${err.message}`);
  }
}

export async function addAIJob(data: any): Promise<void> {
  if (!_redisAvailable || !aiQueue) {
    logger.debug('Queue not available — caller should use direct processing');
    return;
  }
  try {
    await aiQueue.add('process-ai', data, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 2000 },
    });
  } catch (err: any) {
    logger.warn(`addAIJob failed: ${err.message}`);
  }
}

export { scraperQueue, aiQueue };
