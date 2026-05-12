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
const crypto_1 = __importDefault(require("crypto"));
const instanceId = crypto_1.default.randomUUID();
async function startBot() {
    logger_1.logger.info(`🤖 Bot instance starting (ID: ${instanceId})`);
    // Register commands
    (0, commands_1.registerCommands)(bot_instance_1.bot);
    // Setup Bot Commands Menu
    await bot_instance_1.bot.setMyCommands([
        { command: 'start', description: '🏠 Boshlash' },
        { command: 'status', description: '📊 Statistika' },
        { command: 'track', description: '🔔 Narx kuzatish' },
        { command: 'help', description: '📚 Yordam' },
    ]).catch(e => logger_1.logger.warn(`setMyCommands error: ${e.message}`));
    // ── CALLBACK QUERIES ─────────────────────────────────────────────
    bot_instance_1.bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        if (!chatId || !query.data)
            return;
        logger_1.logger.info(`🖱 Callback: ${query.data} from ${chatId}`);
        // Simple dispatcher for now
        if (query.data.startsWith('dl_yt_')) {
            await bot_instance_1.bot.sendMessage(chatId, "📥 Video/Audio yuklanmoqda... (Tez kunda)");
        }
        else if (query.data === 'cancel_dl') {
            await bot_instance_1.bot.deleteMessage(chatId, query.message.message_id);
        }
        await bot_instance_1.bot.answerCallbackQuery(query.id);
    });
    // ── GENERIC MESSAGE HANDLER (Links, Music, etc.) ─────────────────
    bot_instance_1.bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/'))
            return;
        const chatId = msg.chat.id;
        // Detect YouTube/Instagram links
        if (msg.text.includes('youtube.com') || msg.text.includes('youtu.be') || msg.text.includes('instagram.com')) {
            const text = `📹 <b>Multimedia havolasi aniqlandi!</b>\n\nYuklab olishni xohlaysizmi?`;
            const inline_keyboard = [
                [{ text: "📥 Yuklash", callback_data: `dl_media_manual` }],
                [{ text: "❌ Bekor qilish", callback_data: `cancel_dl` }]
            ];
            await bot_instance_1.bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
        }
    });
    // Use Polling for better stability on Render free tier
    await bot_instance_1.bot.deleteWebHook();
    bot_instance_1.bot.startPolling({ polling: { interval: 1000 } });
    logger_1.logger.info(`🚀 Polling started (Production mode)`);
    // Startup notification
    if (config_1.CONFIG.OWNER_ID) {
        await (0, bot_instance_1.notify)(config_1.CONFIG.OWNER_ID, `🚀 <b>Newsroom Bot v11.0 Modularized</b> is active!`);
    }
}
/**
 * Safe send with media support
 * This will be called by AI Workers
 */
async function safeSend(user, article) {
    const caption = `${article.emoji || '🗞'} <b>${article.title}</b>\n\n${article.content}\n\n🔗 <a href="${article.url}">${article.source}</a>`;
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
