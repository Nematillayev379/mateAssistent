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

export async function processArticleInline(userId: number, article: any, sourceLang: string): Promise<void> {
  try {
    const user = await DBService.getUser(userId);
    if (!user || !user.target_channel || !user.is_active) return;

    const userLang = user.language || sourceLang || 'uz';

    const systemPrompt = `You are a professional news editor. 
    Summarize the news in ${userLang} language. 
    Keep it under 100 words, engaging, and use relevant emojis. 
    Do not include the source link at the end. 
    Response language must be strictly: ${userLang}.`;

    const userPrompt = `Title: ${article.title}\nContent: ${article.content}\nSource Language: ${sourceLang}`;
    
    logger.info(`🤖 AI processing for user ${userId} in ${userLang}...`);
    const summary = await getSmartAIResponse(systemPrompt, userPrompt);

    if (!summary || summary.length < 10) {
      logger.warn(`⚠️ AI returned invalid summary for user ${userId}`);
      return;
    }

    const enrichedArticle = { 
      ...article, 
      content: summary, 
      emoji: '🗞',
      source: article.source || 'Newsroom'
    };

    await safeSend(user, enrichedArticle);
    logger.info(`✅ [inline] Post sent to channel ${user.target_channel} in ${userLang}`);
  } catch (err: any) {
    logger.error(`❌ Inline article processing error for user ${userId}: ${err.message}`);
    throw err; // Rethrow to prevent markSeen in caller if needed
  }
}

export {};
