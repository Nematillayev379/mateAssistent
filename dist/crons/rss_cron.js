"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupRSSCron = setupRSSCron;
const node_cron_1 = __importDefault(require("node-cron"));
const database_1 = require("../services/database");
const queue_1 = require("../services/queue");
const scraper_1 = require("../services/scraper");
const scraper_worker_1 = require("../workers/scraper_worker");
const logger_1 = require("../utils/logger");
const userLastRun = new Map();
function setupRSSCron() {
    node_cron_1.default.schedule('* * * * *', async () => {
        try {
            const users = await database_1.DBService.getActiveUsers();
            for (const user of users) {
                const intervalMs = (user.interval_minutes || 15) * 60 * 1000;
                const lastRun = userLastRun.get(user.telegram_id) || 0;
                const now = Date.now();
                const nowObj = new Date();
                const currentTime = `${nowObj.getHours().toString().padStart(2, '0')}:${nowObj.getMinutes().toString().padStart(2, '0')}`;
                // Strategy 1: Fixed Schedule
                if (user.schedule_times && user.schedule_times.trim() !== '') {
                    const times = user.schedule_times.split(',').map((t) => t.trim());
                    if (!times.includes(currentTime))
                        continue;
                    // Avoid multiple triggers within the same minute
                    if (now - lastRun < 65000)
                        continue;
                }
                // Strategy 2: Interval
                else if (now - lastRun < intervalMs) {
                    continue;
                }
                userLastRun.set(user.telegram_id, now);
                const sources = await database_1.DBService.getUserSources(user.telegram_id);
                if (!sources || sources.length === 0)
                    continue;
                logger_1.logger.info(`⏰ RSS cron: processing ${sources.length} sources for user ${user.telegram_id}`);
                for (const source of sources) {
                    if ((0, queue_1.isRedisAvailable)()) {
                        await (0, queue_1.addScraperJob)({
                            userId: user.telegram_id,
                            sourceUrl: source.url,
                            sourceName: source.name,
                            lang: source.lang || 'uz',
                        });
                    }
                    else {
                        await processDirectly(user.telegram_id, source);
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`❌ RSS Cron Error: ${error}`);
        }
    });
    logger_1.logger.info('📅 RSS cron scheduled (every minute, respects user intervals)');
}
async function processDirectly(userId, source) {
    try {
        const articles = await scraper_1.ScraperService.fetchRSS(source.url);
        const lang = source.lang || 'uz';
        for (const article of articles) {
            const seen = await database_1.DBService.isSeen(userId, article.link);
            if (seen)
                continue;
            const titleSeen = await database_1.DBService.isSeenByTitle(userId, article.title);
            if (titleSeen)
                continue;
            logger_1.logger.info(`🆕 [direct] New article: ${article.title}`);
            const articleData = {
                title: article.title,
                url: article.link,
                source: source.name,
                content: article.contentSnippet || article.content || '',
                imageUrl: article.imageUrl || null,
                pubDate: article.pubDate,
            };
            await (0, scraper_worker_1.processArticleInline)(userId, articleData, lang);
            await database_1.DBService.markSeen(userId, article.link, article.title);
        }
    }
    catch (err) {
        logger_1.logger.warn(`⚠️ Direct RSS process error for ${source.url}: ${err.message}`);
    }
}
