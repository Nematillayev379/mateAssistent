"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processArticleInline = processArticleInline;
const bullmq_1 = require("bullmq");
const config_1 = require("../config/config");
const scraper_1 = require("../services/scraper");
const database_1 = require("../services/database");
const queue_1 = require("../services/queue");
const redis_1 = require("../services/redis");
const ai_1 = require("../services/ai");
const telegram_1 = require("../services/telegram");
const logger_1 = require("../utils/logger");
const crypto_1 = __importDefault(require("crypto"));
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
                const locked = database_1.DBService.acquireRecentNewsLock(userId, article.link, article.title);
                if (!locked) {
                    await database_1.DBService.incrementStat(userId, "total_duplicates");
                    continue;
                }
                const isDuplicate = await database_1.DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
                if (isDuplicate) {
                    await database_1.DBService.incrementStat(userId, "total_duplicates");
                    continue;
                }
                const articleData = {
                    title: article.title,
                    url: article.link,
                    source: sourceName,
                    content: article.contentSnippet || article.content || "",
                    imageUrl: article.imageUrl || null,
                    pubDate: article.pubDate,
                };
                if ((0, queue_1.isRedisAvailable)()) {
                    const linkHash = crypto_1.default.createHash("md5").update(article.link).digest("hex");
                    const { aiQueue } = await Promise.resolve().then(() => __importStar(require("../services/queue")));
                    if (aiQueue) {
                        await aiQueue.add("process-ai", { userId, article: articleData, lang }, { jobId: `ai_${userId}_${linkHash}` });
                    }
                }
                else {
                    const { aiQueue: memAiQueue } = await Promise.resolve().then(() => __importStar(require("../services/memory_queue")));
                    await memAiQueue.add("process-article", { userId, article: articleData, lang }, { jobId: `ai_${userId}_${crypto_1.default.createHash("md5").update(article.link).digest("hex")}` });
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Scraper Worker Error: ${error}`);
            throw error;
        }
    }, { connection: connectionOptions });
    scraperWorker.on("error", (err) => {
        if (err.message.includes("limit exceeded")) {
            logger_1.logger.error("Upstash Redis limit exceeded! Pausing scraper worker to prevent spam.");
            scraperWorker.pause().catch(() => { });
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
        if ((article.content || "").length < 200 && article.url) {
            try {
                const full = await scraper_1.ScraperService.scrapeArticle(article.url);
                if (full?.content)
                    article.content = full.content;
            }
            catch { }
        }
        const { moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } = await Promise.resolve().then(() => __importStar(require("../services/ai")));
        const moderation = await moderateContent(article.title, article.content || "");
        if (moderation.status === "BLOCKED") {
            database_1.DBService.releaseUserSendSlot(userId);
            return;
        }
        const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content || "");
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
        const category = await categorizeNews(article.title, summary);
        const emoji = await getNiceEmoji(article.title);
        await (0, telegram_1.safeSend)(user, {
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
