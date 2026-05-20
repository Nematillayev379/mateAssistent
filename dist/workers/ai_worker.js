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
    logger_1.logger.warn("ai_worker: no Redis connection options, worker not started");
}
else {
    const aiWorker = new bullmq_1.Worker("ai-queue", async (job) => {
        const { userId, article, lang } = job.data;
        try {
            logger_1.logger.info(`Job ${job.id}: AI processing for ${(0, logger_1.sanitizeLogInput)(article.title)}`);
            const adKeywords = config_1.CONFIG.AD_KEYWORDS.map((k) => k.toLowerCase());
            const textToScan = `${article.title} ${article.content || ""}`.toLowerCase();
            if (adKeywords.some((k) => textToScan.includes(k))) {
                logger_1.logger.info(`Ad filtered: ${(0, logger_1.sanitizeLogInput)(article.title)}`);
                return;
            }
            const user = await database_1.DBService.getUser(userId);
            if (!user || !user.target_channel || !user.is_active) {
                logger_1.logger.info(`Skip AI: User ${userId} inactive or no channel`);
                return;
            }
            const moderation = await (0, ai_1.moderateContent)(article.title, article.content || "");
            if (moderation.status === "BLOCKED") {
                logger_1.logger.warn(`Article blocked for user ${userId}: ${(0, logger_1.sanitizeLogInput)(moderation.reason)}`);
                return;
            }
            const isSemanticDup = await (0, ai_1.checkSemanticDuplicate)(userId, article.title, article.content || "");
            if (isSemanticDup) {
                await database_1.DBService.incrementStat(userId, "total_duplicates");
                return;
            }
            const intervalMinutes = Math.max(Number(user.interval_minutes) || 15, 1);
            if (!database_1.DBService.tryReserveUserSendSlot(userId, intervalMinutes)) {
                logger_1.logger.info(`Skip AI send for user ${userId}: interval cooldown active`);
                return;
            }
            const userLang = user?.language || lang || "uz";
            const langMap = { uz: "O'zbek", ru: "Russian", en: "English", tr: "Turkish" };
            const fullLangName = langMap[userLang] || userLang;
            const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Use professional tone. Response MUST be in ${fullLangName}.`;
            const userPrompt = `Title: ${article.title}\nContent: ${article.content || ""}`;
            const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
            if (!summary || summary.length < 10) {
                database_1.DBService.releaseUserSendSlot(userId);
                logger_1.logger.warn(`Skip AI: Summary generation failed or too short for user ${userId}`);
                return;
            }
            const category = await (0, ai_1.categorizeNews)(article.title, summary);
            const emoji = await (0, ai_1.getNiceEmoji)(article.title);
            const enrichedArticle = {
                ...article,
                content: summary,
                emoji: emoji || "🔹",
                category,
            };
            await (0, telegram_1.safeSend)(user, enrichedArticle);
            if (article.url && article.title) {
                await database_1.DBService.markSeen(userId, article.url, article.title);
            }
            logger_1.logger.info(`Post sent to channel ${user.target_channel} for user ${userId}`);
        }
        catch (error) {
            database_1.DBService.releaseUserSendSlot(userId);
            const isPermanent = error.message?.includes("400") || error.message?.includes("Bad Request");
            if (isPermanent) {
                logger_1.logger.error(`Permanent AI error for job ${job.id}: ${error.message}. Skipping.`);
                return;
            }
            logger_1.logger.error(`AI Worker Error for job ${job.id}: ${error.message}`);
            throw error;
        }
    }, { connection: connectionOptions });
    aiWorker.on("error", (err) => {
        if (err.message.includes("limit exceeded")) {
            logger_1.logger.error("Upstash Redis limit exceeded! Pausing AI worker to prevent spam.");
            aiWorker.pause().catch(() => { });
        }
        else {
            logger_1.logger.error(`AI worker error: ${err.message}`);
        }
    });
    logger_1.logger.info("AI Worker started with Redis connection options");
}
