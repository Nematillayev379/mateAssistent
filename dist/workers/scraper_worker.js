"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processArticleInline = processArticleInline;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config/config");
const scraper_1 = require("../services/scraper");
const database_1 = require("../services/database");
const queue_1 = require("../services/queue");
const ai_1 = require("../services/ai");
const telegram_1 = require("../services/telegram");
const logger_1 = require("../utils/logger");
if (!config_1.CONFIG.REDIS_URL || config_1.CONFIG.REDIS_URL.trim() === '') {
    logger_1.logger.warn('scraper_worker: no REDIS_URL, worker not started');
}
else {
    const redisConnection = new ioredis_1.default(config_1.CONFIG.REDIS_URL, {
        maxRetriesPerRequest: null,
    });
    const scraperWorker = new bullmq_1.Worker('scraper-queue', async (job) => {
        const { userId, sourceUrl, sourceName, lang } = job.data;
        try {
            logger_1.logger.info(`🔍 Job ${job.id}: Scraping ${sourceUrl} for user ${userId}`);
            const articles = await scraper_1.ScraperService.fetchRSS(sourceUrl);
            for (const article of articles) {
                const seen = await database_1.DBService.isSeen(userId, article.link);
                if (seen)
                    continue;
                const titleSeen = await database_1.DBService.isSeenByTitle(userId, article.title);
                if (titleSeen)
                    continue;
                logger_1.logger.info(`🆕 New article found: ${article.title}`);
                const articleData = {
                    title: article.title,
                    url: article.link,
                    source: sourceName,
                    content: article.contentSnippet || article.content || '',
                    imageUrl: article.imageUrl || null,
                    pubDate: article.pubDate,
                };
                if ((0, queue_1.isRedisAvailable)()) {
                    await (0, queue_1.addAIJob)({ userId, article: articleData, lang });
                }
                else {
                    await processArticleInline(userId, articleData, lang);
                }
                await database_1.DBService.markSeen(userId, article.link, article.title);
            }
        }
        catch (error) {
            logger_1.logger.error(`❌ Scraper Worker Error: ${error}`);
            throw error;
        }
    }, { connection: redisConnection });
    logger_1.logger.info('👷 Scraper Worker started');
}
async function processArticleInline(userId, article, lang) {
    try {
        const systemPrompt = `Siz professional jurnalist va Telegram kanal adminisiz. 
    Berilgan yangilikni qisqa (maks 100 so'z), qiziqarli va emojilar bilan boyitilgan holda ${lang || 'uz'} tilida xulosa qiling. 
    Post oxirida manbani ko'rsatmang (u alohida qo'shiladi).`;
        const userPrompt = `Sarlavha: ${article.title}\nMazmun: ${article.content}`;
        const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
        if (!summary)
            return;
        const enrichedArticle = { ...article, content: summary, emoji: '🗞' };
        const user = await database_1.DBService.getUser(userId);
        if (user && user.target_channel && user.is_active) {
            await (0, telegram_1.safeSend)(user, enrichedArticle);
            logger_1.logger.info(`✅ [inline] Post sent to channel ${user.target_channel}`);
        }
    }
    catch (err) {
        logger_1.logger.error(`❌ Inline article processing error: ${err.message}`);
    }
}
