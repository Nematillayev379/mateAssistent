"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processArticleInline = processArticleInline;
const bullmq_1 = require("bullmq");
const config_1 = require("../config/config");
const scraper_1 = require("../services/scraper");
const database_1 = require("../services/database");
const redis_1 = require("../services/redis");
const ai_1 = require("../services/ai");
const sender_1 = require("../services/sender");
const logger_1 = require("../utils/logger");
const lowerAdKeywords = (config_1.CONFIG.AD_KEYWORDS || []).map((k) => k.toLowerCase());
const connectionOptions = (0, redis_1.getRedisOptions)();
if (!connectionOptions) {
    logger_1.logger.warn("scraper_worker: no Redis connection options, worker not started");
}
else {
    const scraperWorker = new bullmq_1.Worker("scraper-queue", async (job) => {
        const { userId, sourceUrl, sourceName, lang } = job.data;
        try {
            logger_1.logger.info(`Job ${job.id}: Scraping ${(0, logger_1.sanitizeLogInput)(sourceUrl)} for user ${userId}`);
            const articles = await scraper_1.ScraperService.fetchRSS(sourceUrl);
            articles.sort((a, b) => new Date(b?.pubDate || 0).getTime() - new Date(a?.pubDate || 0).getTime());
            for (const article of articles) {
                const isDuplicate = await database_1.DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
                if (isDuplicate) {
                    await database_1.DBService.incrementStat(userId, "total_duplicates");
                    continue;
                }
                await database_1.DBService.markSeen(userId, article.link, article.title);
                await processArticleInline(userId, {
                    title: article.title,
                    url: article.link,
                    source: sourceName,
                    content: article.contentSnippet || article.content || "",
                    imageUrl: article.imageUrl || null,
                    pubDate: article.pubDate,
                }, lang);
            }
        }
        catch (error) {
            logger_1.logger.error(`Scraper Worker Error: ${error}`);
            throw error;
        }
    }, { connection: connectionOptions });
    let lastLimitError = 0;
    const LIMIT_ERROR_COOLDOWN = 60000;
    scraperWorker.on("error", (err) => {
        if (err.message.includes("limit exceeded") || err.message.toLowerCase().includes("exceeded")) {
            const now = Date.now();
            if (now - lastLimitError > LIMIT_ERROR_COOLDOWN) {
                logger_1.logger.warn(`Scraper worker: limit exceeded (cooling down 60s)`);
                lastLimitError = now;
            }
        }
        else {
            logger_1.logger.error(`Scraper worker error: ${err.message}`);
        }
    });
    logger_1.logger.info("Scraper Worker started with Redis connection options");
}
async function processArticleInline(userId, article, sourceLang) {
    try {
        const user = await database_1.DBService.getUser(userId);
        if (!user || !user.target_channel || user.is_active === 0)
            return;
        const lockUrl = article.url || article.link || '';
        const lockTitle = article.title || '';
        if (!database_1.DBService.acquireRecentNewsLock(userId, lockUrl, lockTitle)) {
            await database_1.DBService.incrementStat(userId, "total_duplicates");
            return;
        }
        const intervalMinutes = Math.max(Number(user.interval_minutes) || 15, 1);
        if (!database_1.DBService.tryReserveUserSendSlot(userId, intervalMinutes)) {
            logger_1.logger.info(`Skip inline send for user ${userId}: interval cooldown active`);
            return;
        }
        const textToScan = `${article.title || ""} ${article.content || ""}`.toLowerCase();
        if (lowerAdKeywords.some((k) => textToScan.includes(k))) {
            database_1.DBService.releaseUserSendSlot(userId);
            return;
        }
        if (((article.content || "").length < 200 || !article.imageUrl) && article.url) {
            try {
                const full = await scraper_1.ScraperService.scrapeArticle(article.url);
                if (full?.content)
                    article.content = full.content;
                if (!article.imageUrl && full?.imageUrl)
                    article.imageUrl = full.imageUrl;
            }
            catch {
                logger_1.logger.warn(`ScrapeArticle fallback failed`);
            }
        }
        const moderation = await (0, ai_1.moderateContent)(article.title, article.content || "");
        if (moderation.status === "BLOCKED") {
            database_1.DBService.releaseUserSendSlot(userId);
            return;
        }
        const isSemanticDup = await (0, ai_1.checkSemanticDuplicate)(userId, article.title, article.content || "");
        if (isSemanticDup) {
            database_1.DBService.releaseUserSendSlot(userId);
            return;
        }
        const userLang = user.language || sourceLang || "uz";
        const langMap = { uz: "O'zbek", ru: "Russian", en: "English", tr: "Turkish" };
        const fullLangName = langMap[userLang] || userLang;
        const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Response MUST be in ${fullLangName}.`;
        const userPrompt = `Title: ${article.title}\nContent: ${article.content || ""}`;
        const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
        if (!summary || summary.length < 10) {
            database_1.DBService.releaseUserSendSlot(userId);
            return;
        }
        const category = await (0, ai_1.categorizeNews)(article.title, summary);
        const emoji = await (0, ai_1.getNiceEmoji)(article.title);
        await (0, sender_1.safeSend)(user, {
            ...article,
            content: summary,
            emoji: emoji || "🔹",
            category,
            source: article.source || "mateAssistent",
        });
    }
    catch (err) {
        database_1.DBService.releaseUserSendSlot(userId);
        logger_1.logger.error(`Inline article processing error for user ${userId}: ${err.message}`);
        throw err;
    }
}
