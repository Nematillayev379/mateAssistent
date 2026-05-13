import { Queue } from 'bullmq';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';
import { getRedisConnection } from './redis';

const connection = getRedisConnection();

export const scraperQueue = connection ? new Queue('scraper-queue', { 
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 100
  }
}) : null;

export const aiQueue = connection ? new Queue('ai-queue', { 
  connection,
  defaultJobOptions: {
    attempts: 5, // AI can be unstable, so more retries
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100
  }
}) : null;

export function isRedisAvailable(): boolean {
  return !!connection;
}

export async function addScraperJob(data: any): Promise<void> {
  if (!scraperQueue) return;
  try {
    await scraperQueue.add('scrape-rss', data);
  } catch (err: any) {
    logger.error(`addScraperJob failed: ${err.message}`);
  }
}

export async function addAIJob(data: any): Promise<void> {
  if (!aiQueue) return;
  try {
    await aiQueue.add('process-ai', data);
  } catch (err: any) {
    logger.error(`addAIJob failed: ${err.message}`);
  }
}
