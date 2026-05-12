import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { CONFIG } from '../config/config';
import { ScraperService } from '../services/scraper';
import { DBService } from '../services/database';
import { addAIJob, isRedisAvailable } from '../services/queue';
import { getSmartAIResponse } from '../services/ai';
import { safeSend } from '../services/telegram';
import { logger } from '../utils/logger';

if (!CONFIG.REDIS_URL || CONFIG.REDIS_URL.trim() === '') {
  logger.warn('scraper_worker: no REDIS_URL, worker not started');
} else {
  const redisConnection = new IORedis(CONFIG.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const scraperWorker = new Worker('scraper-queue', async (job: Job) => {
    const { userId, sourceUrl, sourceName, lang } = job.data;

    try {
      logger.info(`🔍 Job ${job.id}: Scraping ${sourceUrl} for user ${userId}`);
      const articles: any[] = await ScraperService.fetchRSS(sourceUrl);

      for (const article of articles) {
        const seen = await DBService.isSeen(userId, article.link);
        if (seen) continue;

        const titleSeen = await DBService.isSeenByTitle(userId, article.title);
        if (titleSeen) continue;

        logger.info(`🆕 New article found: ${article.title}`);

        const articleData = {
          title: article.title,
          url: article.link,
          source: sourceName,
          content: article.contentSnippet || article.content || '',
          imageUrl: article.imageUrl || null,
          pubDate: article.pubDate,
        };

        if (isRedisAvailable()) {
          await addAIJob({ userId, article: articleData, lang });
        } else {
          await processArticleInline(userId, articleData, lang);
        }

        await DBService.markSeen(userId, article.link, article.title);
      }
    } catch (error) {
      logger.error(`❌ Scraper Worker Error: ${error}`);
      throw error;
    }
  }, { connection: redisConnection });

  logger.info('👷 Scraper Worker started');
}

export async function processArticleInline(userId: number, article: any, lang: string): Promise<void> {
  try {
    const systemPrompt = `Siz professional jurnalist va Telegram kanal adminisiz. 
    Berilgan yangilikni qisqa (maks 100 so'z), qiziqarli va emojilar bilan boyitilgan holda ${lang || 'uz'} tilida xulosa qiling. 
    Post oxirida manbani ko'rsatmang (u alohida qo'shiladi).`;

    const userPrompt = `Sarlavha: ${article.title}\nMazmun: ${article.content}`;
    const summary = await getSmartAIResponse(systemPrompt, userPrompt);

    if (!summary) return;

    const enrichedArticle = { ...article, content: summary, emoji: '🗞' };
    const user = await DBService.getUser(userId);

    if (user && user.target_channel && user.is_active) {
      await safeSend(user, enrichedArticle);
      logger.info(`✅ [inline] Post sent to channel ${user.target_channel}`);
    }
  } catch (err: any) {
    logger.error(`❌ Inline article processing error: ${err.message}`);
  }
}

export {};
