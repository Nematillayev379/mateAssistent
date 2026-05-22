import { isRedisAvailable } from '../services/queue';
import { logger } from '../utils/logger';
import { DBService } from '../services/database';

export async function startWorkers(): Promise<void> {
  if (!isRedisAvailable()) {
    logger.info('No Redis — using inline processing (memory queue)');
    return;
  }

  try {
    await import('./scraper_worker');
    logger.info('Scraper worker started (AI processing runs inline)');
  } catch (err: any) {
    logger.warn(`Workers failed to start: ${err.message} — falling back to inline processing`);
  }
}
