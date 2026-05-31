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
exports.handleCallbackQuery = handleCallbackQuery;
exports.resolveMediaUrl = resolveMediaUrl;
const database_1 = require("../services/database");
const logger_1 = require("../utils/logger");
const i18n_1 = require("../services/i18n");
const config_1 = require("../config/config");
const bot_instance_1 = require("../services/bot_instance");
const payment_1 = require("../services/payment");
const help_1 = require("./help");
const admin_1 = require("./admin");
const start_1 = require("./start");
function buildDashboardUrl(chatId) {
    if (!config_1.CONFIG.PUBLIC_URL)
        return null;
    return `${config_1.CONFIG.PUBLIC_URL}/dashboard/overview.html?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}&v=${Date.now()}`;
}
async function handleCallbackQuery(bot, query, userStates) {
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
                    { command: "workspace", description: `Workspace / Workspace` },
                    { command: "lang", description: `Tilni o'zgartirish / Language` },
                    { command: "help", description: `${i18n_1.i18n.t("menu_help", { lng: langCode })} / Yordam` },
                    { command: "admin", description: `Admin panel / Admin` },
                ], { scope: { type: "chat", chat_id: chatId } });
            }
            catch (e) {
                logger_1.logger.warn(`setMyCommands error: ${e.message}`);
            }
            await bot.answerCallbackQuery(query.id, { text: "OK" });
            await bot.sendMessage(chatId, i18n_1.i18n.t("bot_lang_saved", { lng: langCode }));
            await (0, start_1.sendNextOnboardingStep)(bot, chatId, { ...user, language: langCode, has_seen_lang: true });
            return;
        }
        if (data.startsWith("interval_")) {
            const minutes = parseInt(data.split("_")[1], 10);
            if (minutes >= 1 && minutes <= 1440) {
                await database_1.DBService.updateUser(chatId, { interval_minutes: minutes });
                await bot.answerCallbackQuery(query.id, { text: `✅ ${minutes} min` });
                await bot.sendMessage(chatId, i18n_1.i18n.t("quick_interval_saved", { lng: lang }));
                await (0, start_1.sendNextOnboardingStep)(bot, chatId);
            }
            return;
        }
        if (data.startsWith("dl_media_")) {
            await handleMediaDownload(bot, query, chatId, user, lang, userStates, data);
            return;
        }
        if (data === "dl_playlist_all") {
            await handlePlaylist(bot, query, chatId, lang, userStates);
            return;
        }
        if (data === "schedule_media") {
            await handleScheduleMedia(bot, query, chatId, lang, userStates);
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
            if (dashUrl)
                inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
            inlineKeyboard.push([{ text: i18n_1.i18n.t("language_change", { lng: lang }), callback_data: "cmd_lang" }]);
            await bot.sendMessage(chatId, i18n_1.i18n.t("bot_settings_panel", { lng: lang }), { reply_markup: { inline_keyboard: inlineKeyboard } });
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
            const botMe = await bot.getMe();
            const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
            await bot.sendMessage(chatId, `${i18n_1.i18n.t("bot_referral_title", { lng: lang })}\n\n${refLink}\n\nTotal: ${refStats.total}\nActive: ${refStats.active}\nLeft for premium: ${refStats.needed}`);
            return;
        }
        if (data === "buy_premium") {
            await handleBuyPremium(bot, chatId, lang);
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
            if (dashUrl)
                inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
            await bot.sendMessage(chatId, i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), { reply_markup: { inline_keyboard: inlineKeyboard } });
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
}
async function handleMediaDownload(bot, query, chatId, user, lang, userStates, data) {
    const type = data.includes("_video_") ? "video" : data.includes("_audio_") ? "audio" : null;
    const sendTarget = data.endsWith("_channel") ? "channel" : "chat";
    if (!type) {
        await bot.answerCallbackQuery(query.id, { text: i18n_1.i18n.t("invalid_format", { lng: lang }), show_alert: true });
        return;
    }
    const url = resolveMediaUrl(query, userStates, chatId);
    if (!url) {
        await bot.answerCallbackQuery(query.id, { text: i18n_1.i18n.t("link_not_found", { lng: lang }), show_alert: true });
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
        logger_1.logger.error(`Media download error: ${err.message}`);
        const userMsg = err.message.includes("yuklab bo'lmadi")
            ? err.message
            : `${i18n_1.i18n.t("media_download_failed", { lng: lang })}: ${err.message.slice(0, 200)}`;
        await bot.editMessageText(userMsg, { chat_id: chatId, message_id: waitMsg.message_id });
    }
}
async function handlePlaylist(bot, query, chatId, lang, userStates) {
    const url = resolveMediaUrl(query, userStates, chatId);
    if (!url) {
        await bot.answerCallbackQuery(query.id, { text: i18n_1.i18n.t("playlist_link_not_found", { lng: lang }), show_alert: true });
        return;
    }
    const waitMsg = await bot.sendMessage(chatId, i18n_1.i18n.t("playlist_loading", { lng: lang }));
    try {
        const { YoutubeService } = await Promise.resolve().then(() => __importStar(require("../services/youtube")));
        const links = await YoutubeService.extractPlaylistLinks(url, 10);
        if (links.length === 0) {
            await bot.editMessageText(i18n_1.i18n.t("playlist_empty", { lng: lang }), { chat_id: chatId, message_id: waitMsg.message_id });
            return;
        }
        let text = `${i18n_1.i18n.t("playlist_header", { lng: lang }).replace("{count}", String(links.length))}\n\n`;
        links.forEach((link, index) => { text += `${index + 1}. ${link.title}\n${link.url}\n\n`; });
        await bot.editMessageText(text, { chat_id: chatId, message_id: waitMsg.message_id, disable_web_page_preview: true });
    }
    catch (err) {
        logger_1.logger.error(`Playlist extract error: ${err.message}`);
        await bot.editMessageText(i18n_1.i18n.t("playlist_error", { lng: lang }), { chat_id: chatId, message_id: waitMsg.message_id });
    }
}
async function handleScheduleMedia(bot, query, chatId, lang, userStates) {
    const canSchedule = await database_1.DBService.checkUserLimit(chatId, "scheduled");
    if (!canSchedule) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("scheduling_limit_reached", { lng: lang }));
        return;
    }
    const url = resolveMediaUrl(query, userStates, chatId);
    if (!url) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("link_not_found", { lng: lang }));
        return;
    }
    userStates.set(chatId, { type: "schedule_time", url, mediaType: "video", createdAt: Date.now() });
    await bot.sendMessage(chatId, i18n_1.i18n.t("bot_schedule_prompt", { lng: lang }));
}
async function handleBuyPremium(bot, chatId, lang) {
    const monthlyPrice = await database_1.DBService.getPrice("monthly");
    const yearlyPrice = await database_1.DBService.getPrice("yearly");
    const paymeLink = await payment_1.PaymentService.generatePaymeLink(chatId, monthlyPrice);
    const clickLink = await payment_1.PaymentService.generateClickLink(chatId, monthlyPrice);
    const dashUrl = buildDashboardUrl(chatId);
    const text = `${i18n_1.i18n.t("bot_premium_title", { lng: lang })}\n\n${i18n_1.i18n.t("monthly_plan", { lng: lang })}: ${monthlyPrice.toLocaleString()} UZS\n${i18n_1.i18n.t("yearly_plan", { lng: lang })}: ${yearlyPrice.toLocaleString()} UZS`;
    const inlineKeyboard = [
        [{ text: `Payme (${monthlyPrice.toLocaleString()} UZS)`, url: paymeLink || "https://payme.uz" }],
        [{ text: `Click (${monthlyPrice.toLocaleString()} UZS)`, url: clickLink || "https://click.uz" }],
    ];
    if (dashUrl)
        inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
}
function resolveMediaUrl(query, userStates, chatId) {
    const pending = userStates.get(chatId);
    if (pending?.url && (pending.type === "media_download" || pending.type === "schedule_time"))
        return pending.url;
    const msg = query.message;
    const replyText = msg?.reply_to_message?.text || "";
    const match = replyText.match(/(https?:\/\/[^\s]+)/);
    if (match)
        return match[0];
    const fromMessage = msg?.text?.match(/(https?:\/\/[^\s]+)/);
    if (fromMessage)
        return fromMessage[0];
    const entities = msg?.reply_to_message?.entities || [];
    const urlEntity = entities.find((e) => e.type === "url" || e.type === "text_link");
    if (!urlEntity)
        return null;
    if (urlEntity.type === "url")
        return replyText.substring(urlEntity.offset, urlEntity.offset + urlEntity.length);
    return urlEntity.url;
}
