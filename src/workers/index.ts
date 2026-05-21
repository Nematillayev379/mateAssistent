import { isRedisAvailable } from '../services/queue';
import { logger } from '../utils/logger';
import { aiQueue as memAiQueue } from '../services/memory_queue';

export async function startWorkers(): Promise<void> {
  if (!isRedisAvailable()) {
    logger.info('ℹ️ Redis not available — starting in-memory queue workers');
    const { processArticleInline } = await import('./scraper_worker');
    const { DBService } = await import('../services/database');

    memAiQueue.process(async (task) => {
      const { userId, article, lang } = task.data;
      try {
        await processArticleInline(userId, article, lang);
        if (article.url && article.title) {
          await DBService.markSeen(userId, article.url, article.title);
        }
      } catch (e: any) {
        logger.error(`Memory queue processing failed: ${e.message}`);
      }
    });

    logger.info('🚀 In-memory queue workers started (concurrency=3)');
    return;
  }

  try {
    await import('./scraper_worker');
    await import('./ai_worker');
    logger.info('🚀 Queue workers started with Redis');
  } catch (err: any) {
    logger.warn(`⚠️ Workers failed to start: ${err.message} — falling back to inline processing`);
  }
}
