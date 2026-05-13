import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../services/redis';
import { CONFIG } from '../config/config';
import { getSmartAIResponse, moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } from '../services/ai';
import { safeSend } from '../services/telegram';
import { logger } from '../utils/logger';
import { DBService } from '../services/database';

const connection = getRedisConnection();

if (!connection) {
  logger.warn('ai_worker: no Redis connection, worker not started');
} else {
  const aiWorker = new Worker('ai-queue', async (job: Job) => {
    const { userId, article, lang } = job.data;

    try {
      logger.info(`🤖 Job ${job.id}: AI processing for ${article.title}`);

      // BUG #103 Fix: Filter out ads
      const adKeywords = (process.env.AD_KEYWORDS || "reklama,buy,sotib oling,click here,bosing").split(',');
      const textToScan = `${article.title} ${article.content}`.toLowerCase();
      if (adKeywords.some(k => textToScan.includes(k.trim().toLowerCase()))) {
        logger.info(`🚫 Ad filtered: ${article.title}`);
        await DBService.markSeen(userId, article.url, article.title);
        return;
      }

      // 1. Content Moderation (Bug #23)
      const moderation = await moderateContent(article.title, article.content);
      if (moderation.status === 'BLOCKED') {
        logger.warn(`🚫 Article blocked for user ${userId}: ${moderation.reason}`);
        // We mark as seen to not process it again
        await DBService.markSeen(userId, article.url, article.title);
        return;
      }

      // 2. Semantic Deduplication (Bug #23)
      const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content);
      if (isSemanticDup) {
        await DBService.incrementStat(userId, 'total_duplicates');
        await DBService.markSeen(userId, article.url, article.title);
        return;
      }

      // 3. AI Summary Generation
      const userLang = lang || 'uz';
      const langMap: Record<string, string> = { 'uz': "O'zbek", 'ru': 'Russian', 'en': 'English', 'tr': 'Turkish' };
      const fullLangName = langMap[userLang] || userLang;

      const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Use professional tone. Response MUST be in ${fullLangName}.`;
      const userPrompt = `Title: ${article.title}\nContent: ${article.content}`;

      const summary = await getSmartAIResponse(systemPrompt, userPrompt);
      if (!summary) throw new Error('AI summary generation failed');

      // 4. Categorization and Emoji (Bug #23)
      const category = await categorizeNews(article.title, summary);
      const emoji = await getNiceEmoji(article.title);

      const enrichedArticle = { 
        ...article, 
        content: summary, 
        emoji: emoji,
        category: category 
      };
      
      const user = await DBService.getUser(userId);

      if (user && user.target_channel && user.is_active) {
        await safeSend(user, enrichedArticle);
        
        // BUG #13: Mark as seen ONLY after successful delivery
        await DBService.markSeen(userId, article.url, article.title);
        logger.info(`✅ Post sent to channel ${user.target_channel} for user ${userId}`);
      }
    } catch (error) {
      logger.error(`❌ AI Worker Error for job ${job.id}: ${error}`);
      throw error; // Let BullMQ handle retries
    }
  }, { connection });

  logger.info('👷 AI Worker started with shared connection (Full Elite Pipeline)');
}

export {};
