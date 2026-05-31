"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChannelPostMarkup = buildChannelPostMarkup;
exports.safeSendToChannels = safeSendToChannels;
exports.safeSend = safeSend;
const bot_instance_1 = require("./bot_instance");
const database_1 = require("./database");
const scraper_1 = require("./scraper");
const logger_1 = require("../utils/logger");
const sendFailureAlertCooldowns = new Map();
let cachedBotUser = null;
let lastBotUserFetch = 0;
function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeUrl(text) {
    return String(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "%3C").replace(/>/g, "%3E");
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
async function getBotUsername() {
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
    return cachedBotUser || "bot";
}
async function buildChannelPostMarkup(article, opts) {
    const botUser = await getBotUsername();
    const safeTitle = escapeHtml(article.title || "");
    const safeContent = escapeHtml(article.content || "");
    const safeSource = escapeHtml(article.source || "yangiliklar");
    const safeUrl = escapeUrl(article.url || "");
    const sourceLine = safeUrl
        ? `🌐 <a href="${safeUrl}">${safeSource}</a>`
        : `🌐 ${safeSource}`;
    const botLine = `🤖 <a href="https://t.me/${botUser}">@${botUser}</a>`;
    const footer = `\n\n${sourceLine}\n${botLine}`;
    const titleBlock = `<b>${safeTitle}</b>`;
    const maxLen = opts?.maxLength || 4096;
    const availableForContent = Math.max(0, maxLen - titleBlock.length - footer.length - 6);
    let finalContent = safeContent;
    if (finalContent.length > availableForContent) {
        finalContent = finalContent.slice(0, Math.max(0, availableForContent - 3)) + "...";
    }
    return `${titleBlock}\n\n${finalContent}${footer}`;
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
async function safeSend(user, article) {
    if (!article) {
        logger_1.logger.warn("safeSend skipped: article is missing");
        return;
    }
    const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
    const caption = await buildChannelPostMarkup(article, { maxLength: isMediaMessage ? 1024 : 4096 });
    try {
        if (!user.target_channel) {
            logger_1.logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
            return;
        }
        const targets = await database_1.DBService.getAllUserChannels(user);
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
                await bot_instance_1.bot.sendMessage(targetChannel, caption, {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                });
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
        catch (inner) {
            logger_1.logger.warn(`Error alert cooldown send failed: ${inner.message}`);
        }
        throw e;
    }
}
