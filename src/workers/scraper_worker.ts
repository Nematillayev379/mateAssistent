import { Worker, Job } from 'bullmq';
import { CONFIG } from '../config/config';
import { ScraperService } from '../services/scraper';
import { DBService } from '../services/database';
import { addAIJob, isRedisAvailable } from '../services/queue';
import { getRedisOptions } from '../services/redis';
import { getSmartAIResponse } from '../services/ai';
import { safeSend } from '../services/telegram';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// BUG-139 Fix: Cache lowercased ad keywords once to avoid mapping on every article
const lowerAdKeywords = (CONFIG.AD_KEYWORDS || []).map(k => k.toLowerCase());

const connectionOptions = getRedisOptions();

if (!connectionOptions) {
  logger.warn('scraper_worker: no Redis connection options, worker not started');
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
          // BUG-119 Fix: Use MD5 hash for jobId to prevent accidental deduplication collisions
          const linkHash = crypto.createHash('md5').update(article.link).digest('hex');
          const { aiQueue } = await import('../services/queue');
          if (aiQueue) {
            await aiQueue.add('process-ai', { userId, article: articleData, lang }, { 
              jobId: `ai_${userId}_${linkHash}` 
            });
            await DBService.markSeen(userId, article.link, article.title);
          }
        } else {
          // BUG-026 Fix: markSeen is called BEFORE processing to avoid infinite retry loops on failure
          await DBService.markSeen(userId, article.link, article.title);
          try {
            await processArticleInline(userId, articleData, lang);
          } catch (e: any) {
            logger.error(`Inline processing failed, but marked as seen to prevent loop: ${e.message}`);
          }
        }
      }
    } catch (error) {
      logger.error(`❌ Scraper Worker Error: ${error}`);
      throw error;
    }
  }, { connection: connectionOptions });

  scraperWorker.on('error', (err) => {
    if (err.message.includes('limit exceeded')) {
      logger.error('🚨 Upstash Redis limit exceeded! Pausing scraper worker to prevent spam.');
      scraperWorker.pause().catch(() => {});
    } else {
      logger.error(`Scraper worker error: ${err.message}`);
    }
  });

  logger.info('👷 Scraper Worker started with Redis connection options');
}

export async function processArticleInline(userId: number, article: any, sourceLang: string): Promise<void> {
  try {
    const user = await DBService.getUser(userId);
    if (!user || !user.target_channel || !user.is_active) return;

    // BUG-104 & BUG-139 Fix: Use pre-computed cached lowerAdKeywords
    const textToScan = `${article.title || ''} ${article.content || ''}`.toLowerCase();
    if (lowerAdKeywords.some(k => textToScan.includes(k))) {
      logger.info(`🚫 Ad filtered: ${article.title}`);
      return;
    }

    // BUG-109 & BUG-027 Fix: Check content is defined, and fallback to empty string if scrape fails completely
    const contentLength = (article.content || '').length;
    if (contentLength < 200 && article.url) {
      try {
        const full = await ScraperService.scrapeArticle(article.url);
        if (full?.content) article.content = full.content;
      } catch {}
    }

    const { moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } = await import('../services/ai');
    
    const moderation = await moderateContent(article.title, article.content || '');
    if (moderation.status === 'BLOCKED') return;

    const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content || '');
    if (isSemanticDup) return;

    const userLang = user.language || sourceLang || 'uz';
    const langMap: Record<string, string> = { 'uz': "O'zbek", 'ru': 'Russian', 'en': 'English', 'tr': 'Turkish' };
    const fullLangName = langMap[userLang] || userLang;

    const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Response MUST be in ${fullLangName}.`;
    const userPrompt = `Title: ${article.title}\nContent: ${article.content || ''}`;
    
    logger.info(`🤖 AI processing [inline] for user ${userId} in ${fullLangName}...`);
    const summary = await getSmartAIResponse(systemPrompt, userPrompt);

    if (!summary || summary.length < 10) return;

    const category = await categorizeNews(article.title, summary);
    const emoji = await getNiceEmoji(article.title);

    const enrichedArticle = { 
      ...article, 
      content: summary, 
      emoji: emoji || '🔹',
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
