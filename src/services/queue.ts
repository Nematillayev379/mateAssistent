import { Queue } from 'bullmq';
import { logger } from '../utils/logger';
import { getRedisOptions } from './redis';

const redisOptions = getRedisOptions();

export const scraperQueue = redisOptions ? new Queue('scraper-queue', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 100
  }
}) : null;

export const aiQueue = redisOptions ? new Queue('ai-queue', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100
  }
}) : null;

export function isRedisAvailable(): boolean {
  return !!redisOptions;
}
export async function addScraperJob(data: any): Promise<void> {
  if (!scraperQueue) {
    logger.debug('addScraperJob: Redis not available, skipping queue');
    return;
  }
  try {
    await scraperQueue.add('scrape-rss', data);
  } catch (err: any) {
    logger.error(`addScraperJob failed: ${err.message}`);
  }
}

export async function addAIJob(data: any): Promise<void> {
  if (!aiQueue) {
    logger.debug('addAIJob: Redis not available, skipping queue');
    return;
  }
  try {
    await aiQueue.add('process-ai', data);
  } catch (err: any) {
    logger.error(`addAIJob failed: ${err.message}`);
  }
}
