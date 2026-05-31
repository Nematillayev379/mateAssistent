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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RssService = void 0;
const bot_instance_1 = require("./bot_instance");
const database_1 = require("./database");
const scraper_1 = require("./scraper");
const scraper_worker_1 = require("../jobs/scraper_worker");
const logger_1 = require("../utils/logger");
exports.RssService = {
    async pruneCache(activeIds) {
        for (const id of userLastRun.keys()) {
            if (!activeIds.has(id))
                userLastRun.delete(id);
        }
    },
    async checkMonitoredChannels() {
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
                    logger_1.logger.info(`New post found on ${(0, logger_1.sanitizeLogInput)(channel.platform)} channel ${(0, logger_1.sanitizeLogInput)(channel.name)}`);
                    const user = await database_1.DBService.getUser(channel.user_id);
                    if (user && user.target_channel) {
                        const caption = `📢 <b>Yangi ${channel.platform} xabari!</b>\n\n${latestPost.title}\n\n🔗 <a href="${latestPost.url}">Ko'rish</a>`;
                        try {
                            await bot_instance_1.bot.sendMessage(user.target_channel, caption, { parse_mode: 'HTML' });
                        }
                        catch (e) {
                            logger_1.logger.warn(`Failed to send monitored channel update: ${e.message}`);
                            try {
                                const errMsg = `⚠️ <b>Kanalga post yuborib bo'lmadi!</b>\n\nBot <code>${user.target_channel}</code> kanalida administrator emas yoki xabar yuborish huquqi yo'q. Iltimos, botni kanalga admin qilib qo'shing.\n\nPost: ${latestPost.title}`;
                                await bot_instance_1.bot.sendMessage(channel.user_id, errMsg, { parse_mode: 'HTML' });
                            }
                            catch (alertErr) {
                                logger_1.logger.error(`Failed to alert user ${channel.user_id} about channel permissions: ${alertErr.message}`);
                            }
                        }
                    }
                    await database_1.DBService.updateMonitoredChannel(channel.id, latestPost.id);
                }
            }
        }
        catch (err) {
            logger_1.logger.error(`checkMonitoredChannels error: ${err.message}`);
        }
    },
    async processDirectly(userId, source) {
        try {
            const articles = await scraper_1.ScraperService.fetchRSS(source.url);
            articles.sort((a, b) => {
                const left = new Date(b?.pubDate || 0).getTime();
                const right = new Date(a?.pubDate || 0).getTime();
                return left - right;
            });
            const lang = source.lang || 'uz';
            for (const article of articles) {
                try {
                    const isDuplicate = await database_1.DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
                    if (isDuplicate)
                        continue;
                    logger_1.logger.info(`[direct] New article: ${(0, logger_1.sanitizeLogInput)(article.title)}`);
                    const articleData = {
                        title: article.title,
                        url: article.link,
                        source: source.name,
                        content: article.contentSnippet || article.content || '',
                        imageUrl: article.imageUrl || null,
                        pubDate: article.pubDate,
                    };
                    try {
                        await database_1.DBService.markSeen(userId, article.link, article.title);
                        await (0, scraper_worker_1.processArticleInline)(userId, articleData, lang);
                    }
                    catch (articleErr) {
                        logger_1.logger.error(`Error inline processing article ${(0, logger_1.sanitizeLogInput)(article.link)}: ${articleErr.message}`);
                    }
                }
                catch (articleErr) {
                    logger_1.logger.error(`Error handling article ${(0, logger_1.sanitizeLogInput)(article.link)}: ${articleErr.message}`);
                }
            }
        }
        catch (err) {
            logger_1.logger.warn(`Direct RSS process error for ${(0, logger_1.sanitizeLogInput)(source.url)}: ${err.message}`);
        }
    },
};
const userLastRun = new Map();
