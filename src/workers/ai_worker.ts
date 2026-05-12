import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { CONFIG } from '../config/config';
import { getSmartAIResponse } from '../services/ai';
import { safeSend } from '../services/telegram';
import { logger } from '../utils/logger';
import { DBService } from '../services/database';

if (!CONFIG.REDIS_URL || CONFIG.REDIS_URL.trim() === '') {
  logger.warn('ai_worker: no REDIS_URL, worker not started');
} else {
  const redisConnection = new IORedis(CONFIG.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const aiWorker = new Worker('ai-queue', async (job: Job) => {
    const { userId, article, lang } = job.data;

    try {
      logger.info(`🤖 Job ${job.id}: AI processing for ${article.title}`);

      const systemPrompt = `Siz professional jurnalist va Telegram kanal adminisiz. 
    Berilgan yangilikni qisqa (maks 100 so'z), qiziqarli va emojilar bilan boyitilgan holda ${lang || 'uz'} tilida xulosa qiling. 
    Post oxirida manbani ko'rsatmang (u alohida qo'shiladi).`;

      const userPrompt = `Sarlavha: ${article.title}\nMazmun: ${article.content}`;

      const summary = await getSmartAIResponse(systemPrompt, userPrompt);

      if (!summary) {
        throw new Error('AI summary generation failed');
      }

      const enrichedArticle = {
        ...article,
        content: summary,
        emoji: '🗞',
      };

      const user = await DBService.getUser(userId);

      if (user && user.target_channel && user.is_active) {
        await safeSend(user, enrichedArticle);
        logger.info(`✅ Post sent to channel ${user.target_channel}`);
      } else {
        logger.warn(`⚠️ User ${userId} not eligible for posting (inactive or no channel)`);
      }
    } catch (error) {
      logger.error(`❌ AI Worker Error: ${error}`);
      throw error;
    }
  }, { connection: redisConnection });

  logger.info('👷 AI Worker started');
}

export {};
