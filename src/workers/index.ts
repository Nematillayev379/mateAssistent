import { isRedisAvailable } from '../services/queue';
import { logger } from '../utils/logger';

export async function startWorkers(): Promise<void> {
  if (!isRedisAvailable()) {
    logger.info('ℹ️ Redis not available — workers skipped, using inline RSS processing');
    return;
  }
  // Workers self-register when imported; guards inside each file prevent
  // Worker construction when REDIS_URL is empty.
  try {
    // CRIT-2 Fix: Use dynamic import instead of require for ESM compatibility
    await import('./scraper_worker');
    await import('./ai_worker');
    logger.info('🚀 Queue workers started');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️ Workers failed to start: ${message} — falling back to inline processing`);
  }
}
