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
exports.setupRSSCron = setupRSSCron;
const node_cron_1 = __importDefault(require("node-cron"));
const database_1 = require("../services/database");
const queue_1 = require("../services/queue");
const scraper_1 = require("../services/scraper");
const scraper_worker_1 = require("../workers/scraper_worker");
const logger_1 = require("../utils/logger");
// BUG-097 Fix: Import bot properly
const bot_instance_1 = require("../services/bot_instance");
const userLastRun = new Map();
// BUG-096 Fix: Track last monitored channel check
let lastMonitoredCheck = 0;
const MONITORED_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
function setupRSSCron() {
    // BUG-030 & BUG-146 Fix: Prune inactive users instead of full clear to prevent midnight thundering herd
    node_cron_1.default.schedule('0 0 * * *', async () => {
        try {
            const activeUsers = await database_1.DBService.getActiveUsers();
            const activeIds = new Set(activeUsers.map(u => u.telegram_id));
            for (const id of userLastRun.keys()) {
                if (!activeIds.has(id))
                    userLastRun.delete(id);
            }
            logger_1.logger.info('🧹 Memory cleanup: userLastRun cache pruned');
        }
        catch { }
    });
    node_cron_1.default.schedule('*/2 * * * *', async () => {
        try {
            const users = await database_1.DBService.getActiveUsers();
            // BUG-096 Fix: Rate limit monitored channel checks
            const now = Date.now();
            if (now - lastMonitoredCheck > MONITORED_CHECK_INTERVAL) {
                lastMonitoredCheck = now;
                await checkMonitoredChannels().catch(err => logger_1.logger.error(`checkMonitoredChannels: ${err.message}`));
            }
            for (const user of users) {
                const intervalMinutes = Math.max(user.interval_minutes || 15, 1);
                const intervalMs = intervalMinutes * 60 * 1000;
                let lastRun = userLastRun.get(user.telegram_id);
                // BUG-118 Fix: Randomize initial state on restart to spread network load (Thundering Herd prevention)
                if (lastRun === undefined) {
                    lastRun = Date.now() - Math.floor(Math.random() * intervalMs);
                    userLastRun.set(user.telegram_id, lastRun);
                }
                const nowMs = Date.now();
                const nowObj = new Date();
                const currentH = nowObj.getHours().toString().padStart(2, '0');
                const currentM = nowObj.getMinutes().toString().padStart(2, '0');
                const currentTime = `${currentH}:${currentM}`;
                // Strategy 1: Fixed Schedule
                if (user.schedule_times && user.schedule_times.trim() !== '') {
                    const times = user.schedule_times.split(',').map((t) => {
                        // BUG-031 Fix: Safer regex parsing for time
                        const match = t.trim().match(/^(\d{1,2})[:.](\d{2})/);
                        if (!match)
                            return null;
                        const h = parseInt(match[1]);
                        const m = parseInt(match[2]);
                        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    }).filter(Boolean);
                    if (!times.includes(currentTime))
                        continue;
                    if (nowMs - lastRun < 65000)
                        continue;
                }
                // Strategy 2: Interval
                else if (nowMs - lastRun < intervalMs) {
                    continue;
                }
                userLastRun.set(user.telegram_id, nowMs);
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
    logger_1.logger.info('📅 RSS cron scheduled (every 2 min, respects user intervals)');
}
// BUG-097 Fix: Use imported bot instance
async function checkMonitoredChannels() {
    try {
        const channels = await database_1.DBService.getMonitoredChannels();
        for (const channel of channels) {
            let latestPost = null;
            if (channel.platform === 'youtube') {
                const { YoutubeService } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
                latestPost = await YoutubeService.getLatestVideo(channel.channel_id);
            }
            else if (channel.platform === 'instagram') {
                const { InstagramService } = await Promise.resolve().then(() => __importStar(require('../services/instagram')));
                latestPost = await InstagramService.getLatestPost(channel.channel_id);
            }
            if (latestPost && latestPost.id !== channel.last_post_id) {
                logger_1.logger.info(`📢 New post found on ${channel.platform} channel ${channel.name}`);
                const user = await database_1.DBService.getUser(channel.user_id);
                if (user && user.target_channel) {
                    const caption = `📢 <b>Yangi ${channel.platform} xabari!</b>\n\n${latestPost.title}\n\n🔗 <a href="${latestPost.url}">Ko'rish</a>`;
                    try {
                        await bot_instance_1.bot.sendMessage(user.target_channel, caption, { parse_mode: 'HTML' });
                    }
                    catch (e) {
                        logger_1.logger.warn(`Failed to send monitored channel update: ${e.message}`);
                    }
                }
                await database_1.DBService.updateMonitoredChannel(channel.id, latestPost.id);
            }
        }
    }
    catch (err) {
        logger_1.logger.error(`checkMonitoredChannels error: ${err.message}`);
    }
}
async function processDirectly(userId, source) {
    try {
        const articles = await scraper_1.ScraperService.fetchRSS(source.url);
        const lang = source.lang || 'uz';
        for (const article of articles) {
            try {
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
                // BUG-117 Fix: Mark seen BEFORE inline processing to prevent parallel race conditions
                await database_1.DBService.markSeen(userId, article.link, article.title);
                try {
                    await (0, scraper_worker_1.processArticleInline)(userId, articleData, lang);
                }
                catch (articleErr) {
                    logger_1.logger.error(`❌ Error inline processing article ${article.link}: ${articleErr.message}`);
                }
            }
            catch (articleErr) {
                logger_1.logger.error(`❌ Error handling article ${article.link}: ${articleErr.message}`);
            }
        }
    }
    catch (err) {
        logger_1.logger.warn(`⚠️ Direct RSS process error for ${source.url}: ${err.message}`);
    }
}
