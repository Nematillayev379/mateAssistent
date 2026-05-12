"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config/config");
const ai_1 = require("../services/ai");
const telegram_1 = require("../services/telegram");
const logger_1 = require("../utils/logger");
const database_1 = require("../services/database");
if (!config_1.CONFIG.REDIS_URL || config_1.CONFIG.REDIS_URL.trim() === '') {
    logger_1.logger.warn('ai_worker: no REDIS_URL, worker not started');
}
else {
    const redisConnection = new ioredis_1.default(config_1.CONFIG.REDIS_URL, {
        maxRetriesPerRequest: null,
    });
    const aiWorker = new bullmq_1.Worker('ai-queue', async (job) => {
        const { userId, article, lang } = job.data;
        try {
            logger_1.logger.info(`🤖 Job ${job.id}: AI processing for ${article.title}`);
            const systemPrompt = `Siz professional jurnalist va Telegram kanal adminisiz. 
    Berilgan yangilikni qisqa (maks 100 so'z), qiziqarli va emojilar bilan boyitilgan holda ${lang || 'uz'} tilida xulosa qiling. 
    Post oxirida manbani ko'rsatmang (u alohida qo'shiladi).`;
            const userPrompt = `Sarlavha: ${article.title}\nMazmun: ${article.content}`;
            const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
            if (!summary) {
                throw new Error('AI summary generation failed');
            }
            const enrichedArticle = {
                ...article,
                content: summary,
                emoji: '🗞',
            };
            const user = await database_1.DBService.getUser(userId);
            if (user && user.target_channel && user.is_active) {
                await (0, telegram_1.safeSend)(user, enrichedArticle);
                logger_1.logger.info(`✅ Post sent to channel ${user.target_channel}`);
            }
            else {
                logger_1.logger.warn(`⚠️ User ${userId} not eligible for posting (inactive or no channel)`);
            }
        }
        catch (error) {
            logger_1.logger.error(`❌ AI Worker Error: ${error}`);
            throw error;
        }
    }, { connection: redisConnection });
    logger_1.logger.info('👷 AI Worker started');
}
