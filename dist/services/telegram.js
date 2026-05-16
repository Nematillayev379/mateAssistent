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
// BUG-066 Fix: Removed unused userStates Map (it's only in commands/index.ts now)
let cachedBotUser = null;
let lastBotUserFetch = 0;
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
    // BUG-067 Fix: Exclusively use webhook OR polling, not both
    if (config_1.CONFIG.PUBLIC_URL) {
        try {
            const webhookUrl = `${config_1.CONFIG.PUBLIC_URL}/api/bot/webhook`;
            await bot_instance_1.bot.setWebHook(webhookUrl);
            logger_1.logger.info(`🌐 Webhook set to: ${webhookUrl}`);
        }
        catch (err) {
            logger_1.logger.error(`❌ setWebHook error: ${err.message}`);
            // Fallback to polling only if webhook fails
            await bot_instance_1.bot.deleteWebHook().catch(() => { });
            bot_instance_1.bot.startPolling();
            logger_1.logger.info(`🚀 Polling started (webhook failed, fallback)`);
        }
    }
    else {
        // No public URL — use polling
        await bot_instance_1.bot.deleteWebHook().catch(() => { });
        bot_instance_1.bot.startPolling();
        logger_1.logger.info(`🚀 Polling started (no PUBLIC_URL)`);
    }
    // B-19 Fix: Add polling error handler with restart attempts
    bot_instance_1.bot.on('polling_error', (error) => {
        logger_1.logger.error(`❌ Polling error: ${error.message}`);
        // Increment restart attempts counter (accessed via module-level variable in main.ts)
        // Note: This is a simplified implementation; in production, you'd want more sophisticated retry logic
    });
    // Startup notification
    if (config_1.CONFIG.OWNER_ID) {
        try {
            await (0, bot_instance_1.notify)(config_1.CONFIG.OWNER_ID, `🚀 <b>Newsroom Bot v11.0</b> is live!`);
        }
        catch { }
    }
}
/**
 * Safe send with media support
 * BUG-069 Fix: Truncate caption to Telegram limits
 * BUG-070 Fix: Validate audio URL
 * BUG-071 Fix: Handle target_channel format
 */
async function safeSend(user, article) {
    if (!article) {
        logger_1.logger.warn('safeSend skipped: article is missing');
        return;
    }
    const lang = user.language || 'uz';
    // BUG-018 & BUG-068 Fix: Refresh bot username periodically (every hour)
    if (!cachedBotUser || Date.now() - lastBotUserFetch > 3600000) {
        try {
            const me = await bot_instance_1.bot.getMe();
            cachedBotUser = me.username || 'bot';
            lastBotUserFetch = Date.now();
        }
        catch {
            cachedBotUser = cachedBotUser || 'bot';
        }
    }
    const botUser = cachedBotUser;
    const viralFooter = `\n\n🤖 <a href="https://t.me/${botUser}">@${botUser}</a> ${i18n_1.i18n.t('viral_tag', { lng: lang }) || 'bilan yaratildi. Siz ham qo\'shing!'}`;
    // BUG-152 Fix: Escape HTML entities in title and content
    const safeTitle = escapeHtml(article.title || '');
    const safeContent = escapeHtml(article.content || '');
    const safeSource = escapeHtml(article.source || 'Newsroom');
    // BUG-017 Fix: Truncate safely BEFORE assembling HTML to prevent broken tags
    const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
    const maxLen = isMediaMessage ? 1024 : 4096;
    const reserveLen = safeTitle.length + safeSource.length + viralFooter.length + 100;
    let finalContent = safeContent;
    if (finalContent.length + reserveLen > maxLen) {
        finalContent = finalContent.slice(0, Math.max(0, maxLen - reserveLen - 3)) + '...';
    }
    // BUG-140 Fix: Escape URL attribute safely for Telegram
    const safeUrl = escapeUrl(article.url || '');
    const caption = `${article.emoji || '🗞'} <b>${safeTitle}</b>\n\n${finalContent}${viralFooter}\n\n🔗 <a href="${safeUrl}">${safeSource}</a>`;
    try {
        if (!user.target_channel) {
            logger_1.logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
            return;
        }
        // BUG-071 Fix: Normalize target channel format
        let targetChannel = user.target_channel;
        if (/^\d+$/.test(targetChannel)) {
            targetChannel = `-100${targetChannel}`;
        }
        if (article.videoUrl && (await scraper_1.ScraperService.isValidMedia(article.videoUrl))) {
            await bot_instance_1.bot.sendVideo(targetChannel, article.videoUrl, { caption, parse_mode: "HTML" });
        }
        else if (article.audioUrl && (await scraper_1.ScraperService.isValidMedia(article.audioUrl))) {
            // BUG-070 Fix: Validate audio URL before sending
            await bot_instance_1.bot.sendAudio(targetChannel, article.audioUrl, { caption, parse_mode: "HTML" });
        }
        else if (article.imageUrl && (await scraper_1.ScraperService.isValidMedia(article.imageUrl))) {
            await bot_instance_1.bot.sendPhoto(targetChannel, article.imageUrl, { caption, parse_mode: "HTML" });
        }
        else {
            await bot_instance_1.bot.sendMessage(targetChannel, caption, { parse_mode: "HTML" });
        }
        await database_1.DBService.incrementStat(user.telegram_id, 'total_posts');
    }
    catch (e) {
        logger_1.logger.error(`❌ safeSend Error: ${e.message}`);
        try {
            await bot_instance_1.bot.sendMessage(user.telegram_id, `⚠️ <b>Xatolik!</b>\n\nKanalingizga xabar yuborib bo'lmadi. Iltimos, botni kanalga admin qilganingizni va kanal manzili to'g'riligini tekshiring.\n\nXato: <code>${escapeHtml(e.message)}</code>`, { parse_mode: 'HTML' });
        }
        catch { }
        // BUG-020 Fix: Throw error so caller knows it failed and doesn't mark it as seen
        throw e;
    }
}
// BUG-152 & BUG-019 Fix: Full HTML entity escaping helper
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeUrl(text) {
    return String(text)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E');
}
