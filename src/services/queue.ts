import { Queue } from 'bullmq';
import { logger } from '../utils/logger';
import { getRedisOptions, getRedisPool } from './redis';

const redisOptions = getRedisOptions();

// When a queue job fails due to limit-exceeded, rotate the pool
function handleLimitError(err: any): void {
  if (err?.message?.includes('limit exceeded') || err?.message?.toLowerCase().includes('exceeded')) {
    const pool = getRedisPool();
    if (pool && pool.markExhausted()) {
      logger.warn('Queue: limit exceeded, pool rotated');
    } else {
      logger.error('Queue: limit exceeded, no tokens left');
    }
  }
}

export const scraperQueue = redisOptions ? new Queue('scraper-queue', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  }
}) : null;

if (scraperQueue) scraperQueue.on('error', handleLimitError);

export function isRedisAvailable(): boolean {
  const pool = getRedisPool();
  return !!pool && pool.hasAvailable();
}
export async function addScraperJob(data: any): Promise<boolean> {
  if (!scraperQueue) {
    logger.debug('addScraperJob: Redis not available, skipping queue');
    return false;
  }
  const pool = getRedisPool();
  if (!pool || !pool.hasAvailable()) {
    logger.debug('addScraperJob: all Redis tokens exhausted, skipping queue');
    return false;
  }
  try {
    await scraperQueue.add('scrape-rss', data);
    return true;
  } catch (err: any) {
    logger.error(`addScraperJob failed: ${err.message}`);
    return false;
  }
}
