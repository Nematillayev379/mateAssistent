import cron from 'node-cron';
import { DBService } from '../services/database';
import { isRedisAvailable, addScraperJob } from '../services/queue';
import { ScraperService } from '../services/scraper';
import { processArticleInline } from '../workers/scraper_worker';
import { logger } from '../utils/logger';

const userLastRun = new Map<number, number>();

export function setupRSSCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const users = await DBService.getActiveUsers();

      for (const user of users) {
        const intervalMs = (user.interval_minutes || 15) * 60 * 1000;
        const lastRun = userLastRun.get(user.telegram_id) || 0;
        const now = Date.now();
        const nowObj = new Date();
        const currentTime = `${nowObj.getHours().toString().padStart(2, '0')}:${nowObj.getMinutes().toString().padStart(2, '0')}`;

        // Strategy 1: Fixed Schedule
        if (user.schedule_times && user.schedule_times.trim() !== '') {
          const times = user.schedule_times.split(',').map((t: string) => t.trim());
          if (!times.includes(currentTime)) continue;
          // Avoid multiple triggers within the same minute
          if (now - lastRun < 65000) continue;
        } 
        // Strategy 2: Interval
        else if (now - lastRun < intervalMs) {
          continue;
        }

        userLastRun.set(user.telegram_id, now);

        const sources = await DBService.getUserSources(user.telegram_id);
        if (!sources || sources.length === 0) continue;

        logger.info(`⏰ RSS cron: processing ${sources.length} sources for user ${user.telegram_id}`);

        for (const source of sources) {
          if (isRedisAvailable()) {
            await addScraperJob({
              userId: user.telegram_id,
              sourceUrl: source.url,
              sourceName: source.name,
              lang: source.lang || 'uz',
            });
          } else {
            await processDirectly(user.telegram_id, source);
          }
        }
      }
    } catch (error) {
      logger.error(`❌ RSS Cron Error: ${error}`);
    }
  });

  logger.info('📅 RSS cron scheduled (every minute, respects user intervals)');
}

async function processDirectly(userId: number, source: any): Promise<void> {
  try {
    const articles: any[] = await ScraperService.fetchRSS(source.url);
    const lang = source.lang || 'uz';

    for (const article of articles) {
      const seen = await DBService.isSeen(userId, article.link);
      if (seen) continue;

      const titleSeen = await DBService.isSeenByTitle(userId, article.title);
      if (titleSeen) continue;

      logger.info(`🆕 [direct] New article: ${article.title}`);

      const articleData = {
        title: article.title,
        url: article.link,
        source: source.name,
        content: article.contentSnippet || article.content || '',
        imageUrl: article.imageUrl || null,
        pubDate: article.pubDate,
      };

      await processArticleInline(userId, articleData, lang);
      await DBService.markSeen(userId, article.link, article.title);
    }
  } catch (err: any) {
    logger.warn(`⚠️ Direct RSS process error for ${source.url}: ${err.message}`);
  }
}
