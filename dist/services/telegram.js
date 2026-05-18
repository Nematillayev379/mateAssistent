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
exports.notify = exports.bot = void 0;
exports.startBot = startBot;
exports.safeSendToChannels = safeSendToChannels;
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
// BUG-066 Fix: Removed unused userStates Map (it's only in commands/index.ts now)
let cachedBotUser = null;
let lastBotUserFetch = 0;
// B-19 Fix: Add polling error handler with restart attempts
const MAX_RESTART_ATTEMPTS = 10;
let pollingRestartAttempts = 0;
async function startBot() {
    logger_1.logger.info(`🤖 Bot instance starting (ID: ${instanceId})`);
    // Register commands
    (0, commands_1.registerCommands)(bot_instance_1.bot);
    // Telegram → Telegram channel monitoring (bot must be admin in source channels)
    const { TelegramMonitorService } = await Promise.resolve().then(() => __importStar(require('./telegram_monitor')));
    bot_instance_1.bot.on('channel_post', async (msg) => {
        try {
            await TelegramMonitorService.handleChannelPost(msg);
        }
        catch (e) {
            logger_1.logger.error(`channel_post handler: ${e.message}`);
        }
    });
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
    if (config_1.CONFIG.PUBLIC_URL && process.env.NODE_ENV !== 'development') {
        try {
            const webhookUrl = `${config_1.CONFIG.PUBLIC_URL}/api/bot/webhook`;
            await bot_instance_1.bot.setWebHook(webhookUrl);
            logger_1.logger.info(`🌐 Webhook set to: ${webhookUrl}`);
        }
        catch (err) {
            logger_1.logger.error(`❌ setWebHook error: ${err.message}`);
            // Fallback to polling only if webhook fails
            await bot_instance_1.bot.deleteWebHook().catch(() => { });
            initPolling();
            logger_1.logger.info(`🚀 Polling started (webhook failed, fallback)`);
        }
    }
    else {
        // No public URL — use polling
        await bot_instance_1.bot.deleteWebHook().catch(() => { });
        initPolling();
        logger_1.logger.info(`🚀 Polling started (no PUBLIC_URL)`);
    }
    // Startup notification
    if (config_1.CONFIG.OWNER_ID) {
        try {
            await (0, bot_instance_1.notify)(config_1.CONFIG.OWNER_ID, `🚀 <b>mateAssistent Bot v11.0</b> is live!`);
        }
        catch { }
    }
}
function initPolling() {
    bot_instance_1.bot.startPolling();
    // B-19 Fix: Add polling error handler with restart attempts
    bot_instance_1.bot.on('polling_error', (error) => {
        logger_1.logger.error(`❌ Polling error: ${error.message}`);
        if (error.message.includes('409 Conflict')) {
            logger_1.logger.warn('⚠️ Polling conflict (another instance?). Stopping polling to avoid spam.');
            bot_instance_1.bot.stopPolling();
            return;
        }
        pollingRestartAttempts++;
        if (pollingRestartAttempts > MAX_RESTART_ATTEMPTS) {
            logger_1.logger.error(`🔥 Too many polling errors (${pollingRestartAttempts}). Giving up to prevent infinite loop.`);
            bot_instance_1.bot.stopPolling();
            return;
        }
        logger_1.logger.info(`🔄 Attempting to recover polling (${pollingRestartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
        // Wait before continuing
        setTimeout(() => {
            if (!bot_instance_1.bot.isPolling()) {
                bot_instance_1.bot.startPolling();
            }
        }, 5000);
    });
}
/**
 * Safe send with media support
 * BUG-069 Fix: Truncate caption to Telegram limits
 * BUG-070 Fix: Validate audio URL
 * BUG-071 Fix: Handle target_channel format
 */
async function safeSendToChannels(user, channels, sendFn) {
    // BUG-005 Fix: Use Promise.allSettled to prevent one failure from stopping all sends
    await Promise.allSettled(channels.map(async (ch) => {
        const normalized = normalizeChannelId(ch);
        if (!normalized)
            return;
        try {
            await sendFn(normalized);
        }
        catch (e) {
            logger_1.logger.warn(`Multi-channel send failed ${normalized}: ${e.message}`);
        }
    }));
}
function normalizeChannelId(channel) {
    let targetChannel = String(channel).trim();
    if (!targetChannel)
        return '';
    if (/^\d+$/.test(targetChannel))
        targetChannel = `-100${targetChannel}`;
    else if (!targetChannel.startsWith('@') && !targetChannel.startsWith('-'))
        targetChannel = `@${targetChannel}`;
    return targetChannel;
}
async function safeSend(user, article) {
    if (!article) {
        logger_1.logger.warn('safeSend skipped: article is missing');
        return;
    }
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
    const botAd = `🤖 <a href="https://t.me/${botUser}">@${escapeHtml(botUser)}</a>`;
    // BUG-152 Fix: Escape HTML entities in title and content
    const safeTitle = escapeHtml(article.title || '');
    const safeContent = escapeHtml(article.content || '');
    const safeSource = escapeHtml(article.source || 'mateAssistent');
    // BUG-140 Fix: Escape URL attribute safely for Telegram
    const safeUrl = escapeUrl(article.url || '');
    const sourceLine = `🔗 <a href="${safeUrl}">${safeSource}</a>`;
    const footer = `\n\n${sourceLine}  ·  ${botAd}`;
    // BUG-017 Fix: Truncate safely BEFORE assembling HTML to prevent broken tags
    const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
    const maxLen = isMediaMessage ? 1024 : 4096;
    const reserveLen = safeTitle.length + footer.length + 50;
    let finalContent = safeContent;
    if (finalContent.length + reserveLen > maxLen) {
        finalContent = finalContent.slice(0, Math.max(0, maxLen - reserveLen - 3)) + '...';
    }
    // Rasm + sarlavha + tavsif + manba havolasi · bot reklamasi
    const caption = `${article.emoji || '🗞'} <b>${safeTitle}</b>\n\n${finalContent}${footer}`;
    try {
        if (!user.target_channel) {
            logger_1.logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
            return;
        }
        const targets = database_1.DBService.getUserOutputChannels(user);
        await safeSendToChannels(user, targets.length ? targets : [user.target_channel], async (targetChannel) => {
            // BUG-003 Fix: Skip isValidMedia HEAD request - Telegram will reject invalid media
            if (article.videoUrl && scraper_1.ScraperService.isMediaUrl(article.videoUrl)) {
                await bot_instance_1.bot.sendVideo(targetChannel, article.videoUrl, { caption, parse_mode: "HTML" });
            }
            else if (article.audioUrl && scraper_1.ScraperService.isMediaUrl(article.audioUrl)) {
                await bot_instance_1.bot.sendAudio(targetChannel, article.audioUrl, { caption, parse_mode: "HTML" });
            }
            else if (article.imageUrl && scraper_1.ScraperService.isMediaUrl(article.imageUrl)) {
                await bot_instance_1.bot.sendPhoto(targetChannel, article.imageUrl, { caption, parse_mode: "HTML" });
            }
            else {
                await bot_instance_1.bot.sendMessage(targetChannel, caption, { parse_mode: "HTML" });
            }
        });
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
