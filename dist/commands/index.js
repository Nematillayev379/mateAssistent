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
exports.commands = void 0;
exports.registerCommands = registerCommands;
const help_1 = require("./help");
const admin_1 = require("./admin");
const setchannel_1 = require("./setchannel");
const status_1 = require("./status");
const track_1 = require("./track");
const start_1 = require("./start");
const lang_1 = require("./lang");
const database_1 = require("../services/database");
const logger_1 = require("../utils/logger");
const i18n_1 = require("../services/i18n");
const config_1 = require("../config/config");
const scraper_1 = require("../services/scraper");
const bot_instance_1 = require("../services/bot_instance");
const payment_1 = require("../services/payment");
exports.commands = [
    start_1.startCommand,
    status_1.statusCommand,
    track_1.trackCommand,
    admin_1.adminCommand,
    setchannel_1.setChannelCommand,
    help_1.helpCommand,
    lang_1.langCommand,
];
function extractUrlFromText(text) {
    const match = text.match(/(https?:\/\/[^\s]+)/);
    return match ? match[0] : null;
}
function isLikelyRssUrl(url) {
    return /rss|feed|xml|atom/i.test(url);
}
function buildDashboardUrl(chatId) {
    if (!config_1.CONFIG.PUBLIC_URL)
        return null;
    return `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}&v=${Date.now()}`;
}
function resolveMediaUrl(query, userStates, chatId) {
    const pending = userStates.get(chatId);
    if (pending?.url && (pending.type === "media_download" || pending.type === "schedule_time")) {
        return pending.url;
    }
    const msg = query.message;
    const replyText = msg?.reply_to_message?.text || "";
    const fromReply = extractUrlFromText(replyText);
    if (fromReply)
        return fromReply;
    const fromMessage = extractUrlFromText(msg?.text || "");
    if (fromMessage)
        return fromMessage;
    const entities = msg?.reply_to_message?.entities || [];
    const urlEntity = entities.find((e) => e.type === "url" || e.type === "text_link");
    if (!urlEntity)
        return null;
    if (urlEntity.type === "url") {
        return replyText.substring(urlEntity.offset, urlEntity.offset + urlEntity.length);
    }
    return urlEntity.url;
}
let cachedBotInfo = null;
function registerCommands(bot) {
    const userStates = new Map();
    const getBotInfo = async () => {
        if (!cachedBotInfo)
            cachedBotInfo = await bot.getMe();
        return cachedBotInfo;
    };
    setInterval(() => {
        const now = Date.now();
        for (const [id, state] of userStates.entries()) {
            if (now - state.createdAt > 30 * 60 * 1000)
                userStates.delete(id);
        }
    }, 5 * 60 * 1000);
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text)
            return;
        logger_1.logger.info(`Incoming from ${chatId} (len=${text.length})`);
        if (text.startsWith("/"))
            return;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || "uz";
        const state = userStates.get(chatId);
        // Onboarding: Language step fallback
        if (user && !user.has_seen_lang) {
            const { sendLanguageStep } = await Promise.resolve().then(() => __importStar(require("./start")));
            await sendLanguageStep(bot, chatId);
            return;
        }
        // Onboarding: Channel connection step
        if (user && !user.target_channel) {
            let targetText = text.trim();
            if (targetText.includes("t.me/")) {
                const parts = targetText.split("t.me/");
                const handle = parts[parts.length - 1].split("/")[0].trim();
                if (handle)
                    targetText = `@${handle}`;
            }
            if (!targetText.startsWith("@") && !targetText.startsWith("-100") && /^[a-zA-Z0-9_]{5,32}$/.test(targetText)) {
                targetText = `@${targetText}`;
            }
            if (targetText.startsWith("@") || targetText.startsWith("-100")) {
                try {
                    const channelChat = await bot.getChat(targetText);
                    const botInfo = await getBotInfo();
                    const member = await bot.getChatMember(channelChat.id, botInfo.id);
                    if (member.status !== "administrator" && member.status !== "creator") {
                        await bot.sendMessage(chatId, i18n_1.i18n.t("bot_channel_not_admin", { lng: lang }));
                        return;
                    }
                    const saved = await database_1.DBService.updateUser(chatId, { target_channel: targetText });
                    if (!saved) {
                        await bot.sendMessage(chatId, i18n_1.i18n.t("bot_channel_save_failed", { lng: lang }));
                        return;
                    }
                    await database_1.DBService.checkAndMarkReferralActive(chatId);
                    await bot.sendMessage(chatId, i18n_1.i18n.t("onboarding_success", { lng: lang }));
                    await (0, start_1.sendNextOnboardingStep)(bot, chatId);
                    return;
                }
                catch {
                    await bot.sendMessage(chatId, i18n_1.i18n.t("err_invalid_channel", { lng: lang }));
                    return;
                }
            }
            else {
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_send_channel_example", { lng: lang }));
                return;
            }
        }
        // Onboarding: RSS feed source URL connection step
        const sources = user?.target_channel ? await database_1.DBService.getUserSources(chatId) : [];
        if (user?.target_channel && sources.length === 0) {
            const trimmed = text.trim();
            let websiteInput = extractUrlFromText(trimmed);
            if (!websiteInput) {
                const compact = trimmed.replace(/\s+/g, "");
                if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(compact)) {
                    websiteInput = `https://${compact}`;
                }
                else if (/^[a-zA-Z0-9-]{2,}$/.test(compact)) {
                    websiteInput = `https://${compact}.uz`;
                }
            }
            if (!websiteInput) {
                await bot.sendMessage(chatId, `${i18n_1.i18n.t("onboarding_rss_body", { lng: lang })}\n\nWebsite yuboring (masalan: <code>kun.uz</code>) — bot RSS ni o'zi topadi.`, { parse_mode: "HTML" });
                return;
            }
            if (!/^https?:\/\//i.test(websiteInput))
                websiteInput = `https://${websiteInput}`;
            const safeWebsite = websiteInput;
            if (!(await scraper_1.ScraperService.isPublicExternalUrl(safeWebsite))) {
                await bot.sendMessage(chatId, i18n_1.i18n.t("err_invalid_url", { lng: lang }));
                return;
            }
            let rssUrl = null;
            if (isLikelyRssUrl(safeWebsite)) {
                rssUrl = safeWebsite;
            }
            else {
                rssUrl = await scraper_1.ScraperService.discoverRSS(safeWebsite);
            }
            if (!rssUrl) {
                await bot.sendMessage(chatId, "Bu sayt uchun RSS topilmadi. Saytning to'liq URL manzilini yuboring (masalan: https://example.com).");
                return;
            }
            const ok = await database_1.DBService.addSource(chatId, "Primary RSS", rssUrl, lang);
            if (!ok) {
                await bot.sendMessage(chatId, i18n_1.i18n.t("err_invalid_url", { lng: lang }));
                return;
            }
            await bot.sendMessage(chatId, `${i18n_1.i18n.t("quick_source_saved", { lng: lang })}\n\nRSS: ${rssUrl}`);
            await (0, start_1.sendNextOnboardingStep)(bot, chatId);
            return;
        }
        // Onboarding: Posting interval cadence step
        if (user?.target_channel && sources.length > 0 && (!user.interval_minutes || Number(user.interval_minutes) < 1)) {
            const minutes = Number(text.trim());
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
                await bot.sendMessage(chatId, i18n_1.i18n.t("quick_invalid_interval", { lng: lang }));
                return;
            }
            await database_1.DBService.updateUser(chatId, { interval_minutes: minutes });
            await bot.sendMessage(chatId, i18n_1.i18n.t("quick_interval_saved", { lng: lang }));
            await (0, start_1.sendNextOnboardingStep)(bot, chatId);
            return;
        }
        if (state?.type === "schedule_time") {
            if (/^\d{1,2}:\d{2}$/.test(text)) {
                const [h, m] = text.split(":").map(Number);
                if (h < 0 || h > 23 || m < 0 || m > 59) {
                    userStates.delete(chatId);
                    await bot.sendMessage(chatId, i18n_1.i18n.t("bot_invalid_time", { lng: lang }));
                    return;
                }
                const now = new Date();
                const scheduledDate = new Date();
                scheduledDate.setHours(h, m, 0, 0);
                if (scheduledDate <= now)
                    scheduledDate.setDate(scheduledDate.getDate() + 1);
                const mediaType = state.mediaType || "video";
                const article = await scraper_1.ScraperService.scrapeArticle(state.url).catch(() => null);
                const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const caption = article?.title ? `<b>${esc(article.title)}</b>\n\n${esc((article.content || "").slice(0, 400))}` : "Scheduled Post";
                await database_1.DBService.addScheduledPost(chatId, mediaType, { url: state.url, caption }, scheduledDate.toISOString());
                userStates.delete(chatId);
                await bot.sendMessage(chatId, `${i18n_1.i18n.t("bot_schedule_saved", { lng: lang })}\n${scheduledDate.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`);
                return;
            }
            userStates.delete(chatId);
            await bot.sendMessage(chatId, i18n_1.i18n.t("bot_schedule_bad_format", { lng: lang }));
            return;
        }
        if (state?.type === "admin_broadcast") {
            if (user?.role !== "owner" && user?.role !== "admin") {
                userStates.delete(chatId);
                return;
            }
            const users = await database_1.DBService.getAllUsers();
            let count = 0;
            await bot.sendMessage(chatId, `${users.length} users in queue...`);
            for (const targetUser of users) {
                try {
                    await bot.sendMessage(targetUser.telegram_id, text, { parse_mode: "HTML" });
                    count++;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                catch { }
            }
            await bot.sendMessage(chatId, `Broadcast complete: ${count}`);
            userStates.delete(chatId);
            return;
        }
        if (/youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/i.test(text)) {
            const mediaUrl = extractUrlFromText(text);
            if (mediaUrl) {
                userStates.set(chatId, { type: "media_download", url: mediaUrl, createdAt: Date.now() });
            }
            const isPlaylist = text.includes("playlist") || text.includes("list=") || text.includes("/sets/");
            const inlineKeyboard = [];
            if (isPlaylist) {
                inlineKeyboard.push([{ text: "Bulk Download", callback_data: "dl_playlist_all" }]);
            }
            inlineKeyboard.push([
                { text: "Video (Chat)", callback_data: "dl_media_video_chat" },
                { text: "Audio (Chat)", callback_data: "dl_media_audio_chat" },
            ]);
            inlineKeyboard.push([
                { text: "Video (Channel)", callback_data: "dl_media_video_channel" },
                { text: "Audio (Channel)", callback_data: "dl_media_audio_channel" },
            ]);
            inlineKeyboard.push([{ text: "Schedule", callback_data: "schedule_media" }]);
            inlineKeyboard.push([{ text: i18n_1.i18n.t("cancel", { lng: lang }), callback_data: "cancel_dl" }]);
            await bot.sendMessage(chatId, `${i18n_1.i18n.t("media_detected", { lng: lang })}\n\n${i18n_1.i18n.t("download_ask", { lng: lang })}`, {
                reply_markup: { inline_keyboard: inlineKeyboard },
                reply_to_message_id: msg.message_id,
            });
        }
    });
    for (const cmd of exports.commands) {
        bot.onText(cmd.pattern, async (msg, match) => {
            try {
                logger_1.logger.info(`Pattern Match: ${cmd.pattern} by ${msg.from?.id}`);
                await cmd.handler(bot, msg, match);
            }
            catch (error) {
                logger_1.logger.error(`Error handling ${cmd.pattern}: ${error.message}`);
            }
        });
    }
    bot.on("pre_checkout_query", async (query) => {
        try {
            const payload = query.invoice_payload;
            if (!payload || !payload.startsWith("premium_sub_")) {
                await bot.answerPreCheckoutQuery(query.id, false, { error_message: "Invalid payment payload" });
                return;
            }
            await bot.answerPreCheckoutQuery(query.id, true);
        }
        catch (e) {
            logger_1.logger.error(`pre_checkout_query error: ${e.message}`);
            try {
                await bot.answerPreCheckoutQuery(query.id, false, { error_message: "Server error" });
            }
            catch { }
        }
    });
    bot.on("successful_payment", async (msg) => {
        const chatId = msg.chat.id;
        const payment = msg.successful_payment;
        if (!payment)
            return;
        try {
            const payload = payment.invoice_payload;
            if (payload?.startsWith("premium_sub_")) {
                const withoutPrefix = payload.replace("premium_sub_", "");
                const isYearly = withoutPrefix.endsWith("_yearly");
                const userIdStr = isYearly ? withoutPrefix.replace("_yearly", "") : withoutPrefix;
                let userId = parseInt(userIdStr, 10);
                if (Number.isNaN(userId) || userId <= 0)
                    userId = chatId;
                const days = isYearly ? 365 : 30;
                await database_1.DBService.setPremium(userId, days);
                const paidUser = await database_1.DBService.getUser(chatId);
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_premium_activated", { lng: paidUser?.language || "uz" }));
            }
        }
        catch (e) {
            logger_1.logger.error(`successful_payment error: ${e.message}`);
        }
    });
    bot.on("callback_query", async (query) => {
        const chatId = query.message?.chat.id;
        if (!chatId || !query.data)
            return;
        const data = query.data;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || "uz";
        try {
            if (data.startsWith("setlang_")) {
                const newLang = data.split("_")[1];
                const langCode = i18n_1.WEBAPP_LANGS.includes(newLang) ? newLang : "uz";
                await database_1.DBService.updateUser(chatId, { language: langCode, has_seen_lang: true });
                try {
                    await bot.setMyCommands([
                        { command: "start", description: `${i18n_1.i18n.t("menu_dashboard", { lng: langCode })} / Boshlash` },
                        { command: "status", description: `${i18n_1.i18n.t("menu_stats", { lng: langCode })} / Statistika` },
                        { command: "setchannel", description: `${i18n_1.i18n.t("menu_channel", { lng: langCode })} / Kanal sozlash` },
                        { command: "track", description: `${i18n_1.i18n.t("menu_referral", { lng: langCode })} / Narx kuzatish` },
                        { command: "help", description: `${i18n_1.i18n.t("menu_help", { lng: langCode })} / Yordam` },
                    ], { scope: { type: "chat", chat_id: chatId } });
                }
                catch (e) {
                    logger_1.logger.warn(`setMyCommands error on setlang: ${e.message}`);
                }
                await bot.answerCallbackQuery(query.id, { text: "OK" });
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_lang_saved", { lng: langCode }));
                await (0, start_1.sendNextOnboardingStep)(bot, chatId, { ...user, language: langCode, has_seen_lang: true });
                return;
            }
            if (data.startsWith("dl_media_")) {
                const type = data.includes("_video_") ? "video" : data.includes("_audio_") ? "audio" : null;
                const sendTarget = data.endsWith("_channel") ? "channel" : "chat";
                if (!type) {
                    await bot.answerCallbackQuery(query.id, { text: "Invalid format", show_alert: true });
                    return;
                }
                const url = resolveMediaUrl(query, userStates, chatId);
                if (!url) {
                    await bot.answerCallbackQuery(query.id, { text: "Link not found", show_alert: true });
                    return;
                }
                if (sendTarget === "channel" && !user?.target_channel) {
                    await bot.answerCallbackQuery(query.id, { text: i18n_1.i18n.t("bot_target_missing", { lng: lang }), show_alert: true });
                    return;
                }
                const waitMsg = await bot.sendMessage(chatId, i18n_1.i18n.t("processing", { lng: lang }));
                try {
                    const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require("../services/youtube")));
                    const filePath = await downloadYouTube(url, type);
                    const deliveryTarget = sendTarget === "channel" ? user.target_channel : chatId;
                    if (type === "video")
                        await bot.sendVideo(deliveryTarget, filePath);
                    else
                        await bot.sendAudio(deliveryTarget, filePath);
                    await bot.deleteMessage(chatId, waitMsg.message_id);
                    if (sendTarget === "channel") {
                        await bot.sendMessage(chatId, i18n_1.i18n.t("bot_media_sent_channel", { lng: lang }));
                    }
                    const fs = await Promise.resolve().then(() => __importStar(require("fs")));
                    if (fs.existsSync(filePath))
                        fs.unlinkSync(filePath);
                    userStates.delete(chatId);
                }
                catch (err) {
                    await bot.editMessageText(`Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
                }
                return;
            }
            if (data === "dl_playlist_all") {
                const url = resolveMediaUrl(query, userStates, chatId);
                if (!url) {
                    await bot.answerCallbackQuery(query.id, { text: "Playlist link not found", show_alert: true });
                    return;
                }
                const waitMsg = await bot.sendMessage(chatId, "Playlist loading...");
                try {
                    const { YoutubeService } = await Promise.resolve().then(() => __importStar(require("../services/youtube")));
                    const links = await YoutubeService.extractPlaylistLinks(url, 10);
                    if (links.length === 0) {
                        await bot.editMessageText("No videos found in the playlist.", { chat_id: chatId, message_id: waitMsg.message_id });
                        return;
                    }
                    let text = `Playlist (${links.length})\n\n`;
                    links.forEach((link, index) => {
                        text += `${index + 1}. ${link.title}\n${link.url}\n\n`;
                    });
                    await bot.editMessageText(text, { chat_id: chatId, message_id: waitMsg.message_id, disable_web_page_preview: true });
                }
                catch (err) {
                    await bot.editMessageText(`Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
                }
                return;
            }
            if (data === "schedule_media") {
                const canSchedule = await database_1.DBService.checkUserLimit(chatId, "scheduled");
                if (!canSchedule) {
                    await bot.sendMessage(chatId, "Scheduling limit reached.");
                    return;
                }
                const url = resolveMediaUrl(query, userStates, chatId);
                if (!url) {
                    await bot.sendMessage(chatId, "Link not found.");
                    return;
                }
                userStates.set(chatId, { type: "schedule_time", url, mediaType: "video", createdAt: Date.now() });
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_schedule_prompt", { lng: lang }));
                return;
            }
            if (data === "cancel_dl") {
                userStates.delete(chatId);
                await bot.deleteMessage(chatId, query.message.message_id);
                return;
            }
            if (data === "cmd_settings") {
                const dashUrl = buildDashboardUrl(chatId);
                const inlineKeyboard = [];
                if (dashUrl) {
                    inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
                }
                inlineKeyboard.push([{ text: "🌐 Language / Tilni o'zgartirish", callback_data: "cmd_lang" }]);
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_settings_panel", { lng: lang }), {
                    reply_markup: { inline_keyboard: inlineKeyboard },
                });
                return;
            }
            if (data === "cmd_lang") {
                const { sendLanguageStep } = await Promise.resolve().then(() => __importStar(require("./start")));
                await sendLanguageStep(bot, chatId);
                await bot.answerCallbackQuery(query.id).catch(() => { });
                return;
            }
            if (data === "cmd_stats" || data === "cmd_analytics") {
                const stats = await database_1.DBService.getStats(chatId);
                await bot.sendMessage(chatId, `${i18n_1.i18n.t("bot_stats_title", { lng: lang })}\n\nPosts: ${stats.total_posts || 0}\nDuplicates: ${stats.total_duplicates || 0}`);
                return;
            }
            if (data === "cmd_referral") {
                const code = await database_1.DBService.ensureReferralCode(chatId);
                const refStats = await database_1.DBService.getReferralStats(chatId);
                const botMe = await getBotInfo();
                const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
                await bot.sendMessage(chatId, `${i18n_1.i18n.t("bot_referral_title", { lng: lang })}\n\n${refLink}\n\nTotal: ${refStats.total}\nActive: ${refStats.active}\nLeft for premium: ${refStats.needed}`);
                return;
            }
            if (data === "buy_premium") {
                const monthlyPrice = await database_1.DBService.getPrice("monthly");
                const yearlyPrice = await database_1.DBService.getPrice("yearly");
                const paymeLink = await payment_1.PaymentService.generatePaymeLink(chatId, monthlyPrice);
                const clickLink = await payment_1.PaymentService.generateClickLink(chatId, monthlyPrice);
                const dashUrl = buildDashboardUrl(chatId);
                const text = `${i18n_1.i18n.t("bot_premium_title", { lng: lang })}\n\nMonthly: ${monthlyPrice.toLocaleString()} UZS\nYearly: ${yearlyPrice.toLocaleString()} UZS`;
                const inlineKeyboard = [
                    [{ text: `Payme (${monthlyPrice.toLocaleString()} UZS)`, url: paymeLink || "https://payme.uz" }],
                    [{ text: `Click (${monthlyPrice.toLocaleString()} UZS)`, url: clickLink || "https://click.uz" }],
                ];
                if (dashUrl) {
                    inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
                }
                await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
                return;
            }
            if (data === "cmd_admin") {
                if (user?.role === "owner" || user?.role === "admin") {
                    await admin_1.adminCommand.handler(bot, query.message, null);
                }
                else {
                    await bot.answerCallbackQuery(query.id, { text: i18n_1.i18n.t("bot_no_permission", { lng: lang }), show_alert: true });
                }
                return;
            }
            if (data === "adm_broadcast") {
                userStates.set(chatId, { type: "admin_broadcast", url: "", createdAt: Date.now() });
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_broadcast_prompt", { lng: lang }));
                return;
            }
            if (data === "cmd_sources" || data === "cmd_studio" || data === "cmd_channel" || data === "cmd_automation") {
                const dashUrl = buildDashboardUrl(chatId);
                const inlineKeyboard = [];
                if (dashUrl) {
                    inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
                }
                await bot.sendMessage(chatId, i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), {
                    reply_markup: { inline_keyboard: inlineKeyboard },
                });
                return;
            }
            if (data === "cmd_help") {
                await help_1.helpCommand.handler(bot, query.message, null);
                return;
            }
            await bot.answerCallbackQuery(query.id).catch(() => { });
        }
        catch (e) {
            logger_1.logger.error(`Callback error: ${e.message}`);
            await bot.answerCallbackQuery(query.id).catch(() => { });
        }
    });
}
