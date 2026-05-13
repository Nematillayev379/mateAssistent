import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { CONFIG } from '../config/config';
import { ScraperService } from '../services/scraper';
import { DBService } from '../services/database';
import { addAIJob, isRedisAvailable } from '../services/queue';
import { getRedisConnection } from '../services/redis';
import { getSmartAIResponse } from '../services/ai';
import { safeSend } from '../services/telegram';
import { logger } from '../utils/logger';

const connection = getRedisConnection();

if (!connection) {
  logger.warn('scraper_worker: no Redis connection, worker not started');
} else {
  const scraperWorker = new Worker('scraper-queue', async (job: Job) => {
    const { userId, sourceUrl, sourceName, lang } = job.data;

    try {
      logger.info(`🔍 Job ${job.id}: Scraping ${sourceUrl} for user ${userId}`);
      const articles: any[] = await ScraperService.fetchRSS(sourceUrl);

      for (const article of articles) {
        const seen = await DBService.isSeen(userId, article.link);
        if (seen) {
          await DBService.incrementStat(userId, 'total_duplicates');
          continue;
        }

        const titleSeen = await DBService.isSeenByTitle(userId, article.title);
        if (titleSeen) {
          await DBService.incrementStat(userId, 'total_duplicates');
          continue;
        }

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
          // BUG #13: We use job ID to prevent duplicate AI jobs while pending
          // But we don't markSeen yet. AI worker will markSeen after successful send.
          const { aiQueue } = await import('../services/queue');
          if (aiQueue) {
            await aiQueue.add('process-ai', { userId, article: articleData, lang }, { 
              jobId: `ai_${userId}_${article.link}` 
            });
          }
        } else {
          await processArticleInline(userId, articleData, lang);
          await DBService.markSeen(userId, article.link, article.title);
        }
      }
    } catch (error) {
      logger.error(`❌ Scraper Worker Error: ${error}`);
      throw error;
    }
  }, { connection });

  logger.info('👷 Scraper Worker started with shared connection');
}

export async function processArticleInline(userId: number, article: any, sourceLang: string): Promise<void> {
  try {
    const user = await DBService.getUser(userId);
    if (!user || !user.target_channel || !user.is_active) return;

    // BUG #103 Fix: Filter out ads
    const adKeywords = (process.env.AD_KEYWORDS || "reklama,buy,sotib oling,click here,bosing").split(',');
    const textToScan = `${article.title} ${article.content}`.toLowerCase();
    if (adKeywords.some(k => textToScan.includes(k.trim().toLowerCase()))) {
      logger.info(`🚫 Ad filtered: ${article.title}`);
      return;
    }

    // BUG #140 Fix: Get full article text if snippet is too short
    if (article.content.length < 200 && article.url) {
      try {
        const full = await ScraperService.scrapeArticle(article.url);
        if (full?.content) article.content = full.content;
      } catch {}
    }

    // Bug #23 Fix: Content Moderation & Deduplication in inline mode
    const { moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } = await import('../services/ai');
    
    const moderation = await moderateContent(article.title, article.content);
    if (moderation.status === 'BLOCKED') return;

    const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content);
    if (isSemanticDup) return;

    const userLang = user.language || sourceLang || 'uz';
    // BUG #133 & #144 Fix: Full language names for AI
    const langMap: Record<string, string> = { 'uz': "O'zbek", 'ru': 'Russian', 'en': 'English', 'tr': 'Turkish' };
    const fullLangName = langMap[userLang] || userLang;

    const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Response MUST be in ${fullLangName}.`;
    const userPrompt = `Title: ${article.title}\nContent: ${article.content}`;
    
    logger.info(`🤖 AI processing [inline] for user ${userId} in ${fullLangName}...`);
    const summary = await getSmartAIResponse(systemPrompt, userPrompt);

    if (!summary || summary.length < 10) return;

    const category = await categorizeNews(article.title, summary);
    const emoji = await getNiceEmoji(article.title);

    const enrichedArticle = { 
      ...article, 
      content: summary, 
      emoji: emoji,
      category: category,
      source: article.source || 'Newsroom'
    };

    await safeSend(user, enrichedArticle);
    logger.info(`✅ [inline] Post sent to channel ${user.target_channel} in ${fullLangName}`);
  } catch (err: any) {
    logger.error(`❌ Inline article processing error for user ${userId}: ${err.message}`);
    throw err;
  }
}

export {};
