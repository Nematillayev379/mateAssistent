"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const redis_1 = require("../services/redis");
const config_1 = require("../config/config");
const ai_1 = require("../services/ai");
const telegram_1 = require("../services/telegram");
const logger_1 = require("../utils/logger");
const database_1 = require("../services/database");
const connectionOptions = (0, redis_1.getRedisOptions)();
if (!connectionOptions) {
    logger_1.logger.warn('ai_worker: no Redis connection options, worker not started');
}
else {
    const aiWorker = new bullmq_1.Worker('ai-queue', async (job) => {
        const { userId, article, lang } = job.data;
        try {
            logger_1.logger.info(`🤖 Job ${job.id}: AI processing for ${(0, logger_1.sanitizeLogInput)(article.title)}`);
            // BUG-104 Fix: Use CONFIG.AD_KEYWORDS instead of process.env
            const adKeywords = config_1.CONFIG.AD_KEYWORDS.map(k => k.toLowerCase());
            const textToScan = `${article.title} ${article.content || ''}`.toLowerCase();
            if (adKeywords.some(k => textToScan.includes(k))) {
                logger_1.logger.info(`🚫 Ad filtered: ${(0, logger_1.sanitizeLogInput)(article.title)}`);
                return;
            }
            // BUG-107 Fix: Check user BEFORE doing expensive AI processing
            const user = await database_1.DBService.getUser(userId);
            if (!user || !user.target_channel || !user.is_active) {
                logger_1.logger.info(`Skip AI: User ${userId} inactive or no channel`);
                return;
            }
            // 1. Content Moderation
            const moderation = await (0, ai_1.moderateContent)(article.title, article.content || '');
            if (moderation.status === 'BLOCKED') {
                logger_1.logger.warn(`🚫 Article blocked for user ${userId}: ${(0, logger_1.sanitizeLogInput)(moderation.reason)}`);
                return;
            }
            // 2. Semantic Deduplication
            const isSemanticDup = await (0, ai_1.checkSemanticDuplicate)(userId, article.title, article.content || '');
            if (isSemanticDup) {
                await database_1.DBService.incrementStat(userId, 'total_duplicates');
                return;
            }
            // 3. AI Summary Generation
            const userLang = lang || 'uz';
            const langMap = { 'uz': "O'zbek", 'ru': 'Russian', 'en': 'English', 'tr': 'Turkish' };
            const fullLangName = langMap[userLang] || userLang;
            const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Use professional tone. Response MUST be in ${fullLangName}.`;
            const userPrompt = `Title: ${article.title}\nContent: ${article.content || ''}`;
            const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
            // BUG-029 Fix: Skip processing instead of throwing error if summary is empty
            if (!summary || summary.length < 10) {
                logger_1.logger.warn(`Skip AI: Summary generation failed or too short for user ${userId}`);
                return;
            }
            // BUG-105 Fix: Reduce AI calls - combine categorization with emoji
            const category = await (0, ai_1.categorizeNews)(article.title, summary);
            const emoji = await (0, ai_1.getNiceEmoji)(article.title);
            // BUG-011 Fix: Ensure emoji has fallback
            const enrichedArticle = {
                ...article,
                content: summary,
                emoji: emoji || '🔹',
                category: category
            };
            await (0, telegram_1.safeSend)(user, enrichedArticle);
            if (article.url && article.title) {
                await database_1.DBService.markSeen(userId, article.url, article.title);
            }
            logger_1.logger.info(`✅ Post sent to channel ${user.target_channel} for user ${userId}`);
        }
        catch (error) {
            // BUG-120 Fix: Do not retry if error is permanent (like 400 Bad Request from AI or UI block)
            const isPermanent = error.message?.includes('400') || error.message?.includes('Bad Request');
            if (isPermanent) {
                logger_1.logger.error(`❌ Permanent AI error for job ${job.id}: ${error.message}. Skipping.`);
                return;
            }
            logger_1.logger.error(`❌ AI Worker Error for job ${job.id}: ${error.message}`);
            throw error; // Let BullMQ handle retries for temporary errors like rate limits
        }
    }, { connection: connectionOptions });
    aiWorker.on('error', (err) => {
        if (err.message.includes('limit exceeded')) {
            logger_1.logger.error('🚨 Upstash Redis limit exceeded! Pausing AI worker to prevent spam.');
            aiWorker.pause().catch(() => { });
        }
        else {
            logger_1.logger.error(`AI worker error: ${err.message}`);
        }
    });
    logger_1.logger.info('👷 AI Worker started with Redis connection options (Full mateAssistent Pipeline)');
}
