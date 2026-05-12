import { isRedisAvailable } from '../services/queue';
import { logger } from '../utils/logger';

export function startWorkers(): void {
  if (!isRedisAvailable()) {
    logger.info('ℹ️ Redis not available — workers skipped, using inline RSS processing');
    return;
  }
  // Workers self-register when imported; guards inside each file prevent
  // Worker construction when REDIS_URL is empty.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./scraper_worker');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./ai_worker');
    logger.info('🚀 Queue workers started');
  } catch (err: any) {
    logger.warn(`⚠️ Workers failed to start: ${err.message} — falling back to inline processing`);
  }
}
