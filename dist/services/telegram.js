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
exports.notify = exports.bot = exports.__testing = void 0;
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
let cachedBotUser = null;
let lastBotUserFetch = 0;
const sendFailureAlertCooldowns = new Map();
const MAX_RESTART_ATTEMPTS = 10;
let pollingRestartAttempts = 0;
let pollingRestartTimer = null;
let pollingErrorHandlerAttached = false;
async function startBot() {
    logger_1.logger.info(`Bot instance starting (ID: ${instanceId})`);
    (0, commands_1.registerCommands)(bot_instance_1.bot);
    const { TelegramMonitorService } = await Promise.resolve().then(() => __importStar(require("./telegram_monitor")));
    bot_instance_1.bot.on("channel_post", async (msg) => {
        try {
            await TelegramMonitorService.handleChannelPost(msg);
        }
        catch (e) {
            logger_1.logger.error(`channel_post handler: ${e.message}`);
        }
    });
    try {
        await bot_instance_1.bot.setMyCommands([
            { command: "start", description: "Boshlash / Main Menu" },
            { command: "status", description: "Statistika / Stats" },
            { command: "setchannel", description: "Kanalni sozlash / Change channel" },
            { command: "track", description: "Narx kuzatish / Price tracking" },
            { command: "help", description: "Yordam / Help Guide" },
        ]);
    }
    catch (e) {
        logger_1.logger.warn(`setMyCommands error: ${e.message}`);
    }
    if (config_1.CONFIG.PUBLIC_URL && process.env.NODE_ENV !== "development") {
        try {
            const webhookUrl = `${config_1.CONFIG.PUBLIC_URL}/api/bot/webhook`;
            await bot_instance_1.bot.setWebHook(webhookUrl, {
                secret_token: config_1.CONFIG.WEBHOOK_SECRET,
                max_connections: 100,
            });
            logger_1.logger.info(`Webhook set to: ${webhookUrl} (max_connections=100)`);
        }
        catch (err) {
            logger_1.logger.error(`setWebHook error: ${err.message}`);
            await bot_instance_1.bot.deleteWebHook().catch(() => { });
            initPolling();
            logger_1.logger.info("Polling started (webhook failed, fallback)");
        }
    }
    else {
        await bot_instance_1.bot.deleteWebHook().catch(() => { });
        initPolling();
        logger_1.logger.info("Polling started (no PUBLIC_URL)");
    }
    if (config_1.CONFIG.OWNER_ID != null) {
        try {
            await (0, bot_instance_1.notify)(config_1.CONFIG.OWNER_ID, `<b>mateAssistent Bot v11.0</b> is live!`);
        }
        catch { }
    }
}
function initPolling() {
    startPollingSafe();
    if (!pollingErrorHandlerAttached) {
        bot_instance_1.bot.on("polling_error", (error) => {
            handlePollingError(error);
        });
        pollingErrorHandlerAttached = true;
    }
}
function getPollingErrorMessage(error) {
    return String(error?.message || error || "Unknown polling error");
}
function isFatalPollingError(message) {
    return /409 Conflict|401 Unauthorized|404 Not Found|connect EACCES/i.test(message);
}
function getPollingRestartDelay(attempt) {
    return Math.min(5000 * Math.max(attempt, 1), 30000);
}
function clearPollingRestartTimer() {
    if (pollingRestartTimer) {
        clearTimeout(pollingRestartTimer);
        pollingRestartTimer = null;
    }
}
function startPollingSafe() {
    clearPollingRestartTimer();
    try {
        const maybePromise = bot_instance_1.bot.startPolling();
        Promise.resolve(maybePromise)
            .then(() => {
            pollingRestartAttempts = 0;
        })
            .catch((error) => {
            logger_1.logger.error(`startPolling error: ${getPollingErrorMessage(error)}`);
        });
    }
    catch (error) {
        logger_1.logger.error(`startPolling throw: ${getPollingErrorMessage(error)}`);
    }
}
function handlePollingError(error) {
    const message = getPollingErrorMessage(error);
    logger_1.logger.error(`Polling error: ${message}`);
    if (message.includes("409 Conflict")) {
        logger_1.logger.warn("Polling conflict detected. Stopping polling.");
        clearPollingRestartTimer();
        bot_instance_1.bot.stopPolling();
        return;
    }
    pollingRestartAttempts++;
    if (isFatalPollingError(message)) {
        logger_1.logger.error(`Fatal polling error detected. Stopping polling after ${pollingRestartAttempts} attempt(s).`);
        clearPollingRestartTimer();
        bot_instance_1.bot.stopPolling();
        return;
    }
    if (pollingRestartAttempts > MAX_RESTART_ATTEMPTS) {
        logger_1.logger.error(`Too many polling errors (${pollingRestartAttempts}). Stopping polling.`);
        clearPollingRestartTimer();
        bot_instance_1.bot.stopPolling();
        return;
    }
    if (pollingRestartTimer)
        return;
    const restartDelay = getPollingRestartDelay(pollingRestartAttempts);
    pollingRestartTimer = setTimeout(() => {
        pollingRestartTimer = null;
        if (!bot_instance_1.bot.isPolling()) {
            startPollingSafe();
        }
    }, restartDelay);
}
async function safeSendToChannels(_user, channels, sendFn) {
    const results = await Promise.allSettled(channels.map(async (ch) => {
        const normalized = normalizeChannelId(ch);
        if (!normalized)
            throw new Error("Empty target channel");
        await sendFn(normalized);
    }));
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            logger_1.logger.warn(`Multi-channel send failed ${channels[index]}: ${result.reason?.message || result.reason}`);
        }
    });
    return results.filter((result) => result.status === "fulfilled").length;
}
function normalizeChannelId(channel) {
    let targetChannel = String(channel).trim();
    if (!targetChannel)
        return "";
    if (/^\d+$/.test(targetChannel))
        targetChannel = `-100${targetChannel}`;
    else if (!targetChannel.startsWith("@") && !targetChannel.startsWith("-"))
        targetChannel = `@${targetChannel}`;
    return targetChannel;
}
async function safeSend(user, article) {
    if (!article) {
        logger_1.logger.warn("safeSend skipped: article is missing");
        return;
    }
    if (!cachedBotUser || Date.now() - lastBotUserFetch > 3600000) {
        try {
            const me = await bot_instance_1.bot.getMe();
            cachedBotUser = me.username || "bot";
            lastBotUserFetch = Date.now();
        }
        catch {
            cachedBotUser = cachedBotUser || "bot";
        }
    }
    const botUser = cachedBotUser;
    const safeTitle = escapeHtml(article.title || "");
    const safeContent = escapeHtml(article.content || "");
    const safeSource = escapeHtml(article.source || "yangiliklar");
    const safeUrl = escapeUrl(article.url || "");
    const sourceLine = `🌐 <a href="${safeUrl}">${safeSource}</a>`;
    const botLine = `🤖 <a href="https://t.me/${botUser}">@${botUser}</a>`;
    const footer = `\n\n${sourceLine}\n${botLine}`;
    const titleBlock = `<b>${safeTitle}</b>`;
    const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
    const maxLen = isMediaMessage ? 1024 : 4096;
    const headerLen = titleBlock.length + 2;
    const footerLen = footer.length + 4;
    const availableForContent = maxLen - headerLen - footerLen;
    let finalContent = safeContent;
    if (finalContent.length > availableForContent) {
        finalContent = finalContent.slice(0, Math.max(0, availableForContent - 3)) + "...";
    }
    const caption = `${titleBlock}\n\n${finalContent}${footer}`;
    try {
        if (!user.target_channel) {
            logger_1.logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
            return;
        }
        const targets = database_1.DBService.getUserOutputChannels(user);
        const sent = await safeSendToChannels(user, targets.length ? targets : [user.target_channel], async (targetChannel) => {
            if (article.videoUrl && scraper_1.ScraperService.isMediaUrl(article.videoUrl)) {
                await bot_instance_1.bot.sendVideo(targetChannel, article.videoUrl, { caption, parse_mode: "HTML" });
            }
            else if (article.audioUrl && scraper_1.ScraperService.isMediaUrl(article.audioUrl)) {
                await bot_instance_1.bot.sendAudio(targetChannel, article.audioUrl, { caption, parse_mode: "HTML" });
            }
            else if (article.imageUrl) {
                await bot_instance_1.bot.sendPhoto(targetChannel, article.imageUrl, { caption, parse_mode: "HTML" });
            }
            else {
                await bot_instance_1.bot.sendMessage(targetChannel, caption, { parse_mode: "HTML" });
            }
        });
        if (sent === 0)
            throw new Error("All target channel sends failed");
        await database_1.DBService.incrementStat(user.telegram_id, "total_posts");
    }
    catch (e) {
        logger_1.logger.error(`safeSend error: ${e.message}`);
        try {
            const cooldownKey = `${user.telegram_id}:${normalizeChannelId(user.target_channel || "")}`;
            const now = Date.now();
            if (now >= (sendFailureAlertCooldowns.get(cooldownKey) || 0)) {
                sendFailureAlertCooldowns.set(cooldownKey, now + 30 * 60 * 1000);
                await bot_instance_1.bot.sendMessage(user.telegram_id, `⚠️ <b>Xatolik!</b>\n\nKanalingizga xabar yuborib bo'lmadi. Iltimos, botni kanalga admin qilganingizni va kanal manzili to'g'riligini tekshiring.\n\nXato: <code>${escapeHtml(e.message)}</code>`, { parse_mode: "HTML" });
            }
        }
        catch { }
        throw e;
    }
}
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function escapeUrl(text) {
    return String(text)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E");
}
exports.__testing = {
    getPollingRestartDelay,
    isFatalPollingError,
    handlePollingError,
    resetPollingState() {
        pollingRestartAttempts = 0;
        clearPollingRestartTimer();
        pollingErrorHandlerAttached = false;
    },
};
