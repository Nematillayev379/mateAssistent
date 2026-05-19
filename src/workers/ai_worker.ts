import { Worker, Job } from 'bullmq';
import { getRedisOptions } from '../services/redis';
import { CONFIG } from '../config/config';
import { getSmartAIResponse, moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } from '../services/ai';
import { safeSend } from '../services/telegram';
import { logger, sanitizeLogInput } from '../utils/logger';
import { DBService } from '../services/database';

const connectionOptions = getRedisOptions();

if (!connectionOptions) {
  logger.warn('ai_worker: no Redis connection options, worker not started');
} else {
  const aiWorker = new Worker('ai-queue', async (job: Job) => {
    const { userId, article, lang } = job.data;

    try {
      logger.info(`🤖 Job ${job.id}: AI processing for ${sanitizeLogInput(article.title)}`);

      // BUG-104 Fix: Use CONFIG.AD_KEYWORDS instead of process.env
      const adKeywords = CONFIG.AD_KEYWORDS.map(k => k.toLowerCase());
      const textToScan = `${article.title} ${article.content || ''}`.toLowerCase();
      if (adKeywords.some(k => textToScan.includes(k))) {
        logger.info(`🚫 Ad filtered: ${sanitizeLogInput(article.title)}`);
        return;
      }

      // BUG-107 Fix: Check user BEFORE doing expensive AI processing
      const user = await DBService.getUser(userId);
      if (!user || !user.target_channel || !user.is_active) {
        logger.info(`Skip AI: User ${userId} inactive or no channel`);
        return;
      }

      // 1. Content Moderation
      const moderation = await moderateContent(article.title, article.content || '');
      if (moderation.status === 'BLOCKED') {
        logger.warn(`🚫 Article blocked for user ${userId}: ${sanitizeLogInput(moderation.reason)}`);
        return;
      }

      // 2. Semantic Deduplication
      const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content || '');
      if (isSemanticDup) {
        await DBService.incrementStat(userId, 'total_duplicates');
        return;
      }

      // 3. AI Summary Generation
      const userLang = lang || 'uz';
      const langMap: Record<string, string> = { 'uz': "O'zbek", 'ru': 'Russian', 'en': 'English', 'tr': 'Turkish' };
      const fullLangName = langMap[userLang] || userLang;

      const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Use professional tone. Response MUST be in ${fullLangName}.`;
      const userPrompt = `Title: ${article.title}\nContent: ${article.content || ''}`;

      const summary = await getSmartAIResponse(systemPrompt, userPrompt);
      // BUG-029 Fix: Skip processing instead of throwing error if summary is empty
      if (!summary || summary.length < 10) {
        logger.warn(`Skip AI: Summary generation failed or too short for user ${userId}`);
        return;
      }

      // BUG-105 Fix: Reduce AI calls - combine categorization with emoji
      const category = await categorizeNews(article.title, summary);
      const emoji = await getNiceEmoji(article.title);

      // BUG-011 Fix: Ensure emoji has fallback
      const enrichedArticle = { 
        ...article, 
        content: summary, 
        emoji: emoji || '🔹',
        category: category 
      };

      await safeSend(user, enrichedArticle);
      if (article.url && article.title) {
        await DBService.markSeen(userId, article.url, article.title);
      }
      logger.info(`✅ Post sent to channel ${user.target_channel} for user ${userId}`);
    } catch (error: any) {
      // BUG-120 Fix: Do not retry if error is permanent (like 400 Bad Request from AI or UI block)
      const isPermanent = error.message?.includes('400') || error.message?.includes('Bad Request');
      if (isPermanent) {
        logger.error(`❌ Permanent AI error for job ${job.id}: ${error.message}. Skipping.`);
        return;
      }
      
      logger.error(`❌ AI Worker Error for job ${job.id}: ${error.message}`);
      throw error; // Let BullMQ handle retries for temporary errors like rate limits
    }
  }, { connection: connectionOptions });

  aiWorker.on('error', (err) => {
    if (err.message.includes('limit exceeded')) {
      logger.error('🚨 Upstash Redis limit exceeded! Pausing AI worker to prevent spam.');
      aiWorker.pause().catch(() => {});
    } else {
      logger.error(`AI worker error: ${err.message}`);
    }
  });

  logger.info('👷 AI Worker started with Redis connection options (Full mateAssistent Pipeline)');
}

export {};
