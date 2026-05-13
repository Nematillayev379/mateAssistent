"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = exports.bot = void 0;
exports.startBot = startBot;
exports.safeSend = safeSend;
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const bot_instance_1 = require("./bot_instance");
Object.defineProperty(exports, "bot", { enumerable: true, get: function () { return bot_instance_1.bot; } });
Object.defineProperty(exports, "notify", { enumerable: true, get: function () { return bot_instance_1.notify; } });
const commands_1 = require("../commands");
const database_1 = require("./database");
const scraper_1 = require("./scraper");
const i18n_1 = require("./i18n");
const crypto_1 = __importDefault(require("crypto"));
const instanceId = crypto_1.default.randomUUID();
const userStates = new Map();
async function startBot() {
    logger_1.logger.info(`🤖 Bot instance starting (ID: ${instanceId})`);
    // Register commands
    (0, commands_1.registerCommands)(bot_instance_1.bot);
    // Setup Bot Commands Menu
    try {
        await bot_instance_1.bot.setMyCommands([
            { command: 'start', description: '🏠 Boshlash' },
            { command: 'status', description: '📊 Statistika' },
            { command: 'track', description: '🔔 Narx kuzatish' },
            { command: 'help', description: '📚 Yordam' },
        ]);
    }
    catch (e) {
        logger_1.logger.warn(`⚠️ setMyCommands error: ${e.message}`);
    }
    // --- WEBHOOK SETUP FOR RENDER ---
    if (config_1.CONFIG.PUBLIC_URL) {
        try {
            const webhookUrl = `${config_1.CONFIG.PUBLIC_URL}/api/bot/webhook`;
            await bot_instance_1.bot.setWebHook(webhookUrl);
            logger_1.logger.info(`🌐 Webhook set to: ${webhookUrl}`);
        }
        catch (err) {
            logger_1.logger.error(`❌ setWebHook error: ${err.message}`);
        }
    }
    else {
        // Fallback to polling if no public URL
        await bot_instance_1.bot.deleteWebHook().catch(() => { });
        bot_instance_1.bot.startPolling({ polling: { interval: 2000 } });
        logger_1.logger.info(`🚀 Polling started (Development mode)`);
    }
    // Startup notification
    if (config_1.CONFIG.OWNER_ID) {
        try {
            await (0, bot_instance_1.notify)(config_1.CONFIG.OWNER_ID, `🚀 <b>Newsroom Bot v11.0</b> is live via Webhook!`);
        }
        catch { }
    }
}
/**
 * Safe send with media support
 * This will be called by AI Workers
 */
async function safeSend(user, article) {
    const lang = user.language || 'uz';
    const botUser = (await bot_instance_1.bot.getMe()).username;
    const viralFooter = `\n\n🤖 <a href="https://t.me/${botUser}">@${botUser}</a> ${i18n_1.i18n.t('viral_tag', { lng: lang }) || 'bilan yaratildi. Siz ham qo\'shing!'}`;
    const caption = `${article.emoji || '🗞'} <b>${article.title}</b>\n\n${article.content}${viralFooter}\n\n🔗 <a href="${article.url}">${article.source}</a>`;
    try {
        if (article.videoUrl && (await scraper_1.ScraperService.isValidMedia(article.videoUrl))) {
            await bot_instance_1.bot.sendVideo(user.target_channel, article.videoUrl, { caption, parse_mode: "HTML" });
        }
        else if (article.audioUrl) {
            await bot_instance_1.bot.sendAudio(user.target_channel, article.audioUrl, { caption, parse_mode: "HTML" });
        }
        else if (article.imageUrl && (await scraper_1.ScraperService.isValidMedia(article.imageUrl))) {
            await bot_instance_1.bot.sendPhoto(user.target_channel, article.imageUrl, { caption, parse_mode: "HTML" });
        }
        else {
            // Fallback text only if no media
            await bot_instance_1.bot.sendMessage(user.target_channel, caption, { parse_mode: "HTML" });
        }
        await database_1.DBService.incrementStat(user.telegram_id, 'total_posts');
    }
    catch (e) {
        logger_1.logger.error(`❌ safeSend Error: ${e.message}`);
    }
}
