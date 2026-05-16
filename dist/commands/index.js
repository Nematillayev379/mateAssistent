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
const start_1 = require("./start");
const status_1 = require("./status");
const track_1 = require("./track");
const admin_1 = require("./admin");
const database_1 = require("../services/database");
const logger_1 = require("../utils/logger");
const i18n_1 = require("../services/i18n");
const config_1 = require("../config/config");
const scraper_1 = require("../services/scraper");
const bot_instance_1 = require("../services/bot_instance");
exports.commands = [
    start_1.startCommand,
    status_1.statusCommand,
    track_1.trackCommand,
    admin_1.adminCommand,
];
let cachedBotInfo = null;
function registerCommands(bot) {
    const userStates = new Map();
    const getBotInfo = async () => {
        if (!cachedBotInfo) {
            cachedBotInfo = await bot.getMe();
        }
        return cachedBotInfo;
    };
    // BUG-150 Fix: Periodic cleanup of stale user states (every 5 minutes)
    setInterval(() => {
        const now = Date.now();
        for (const [id, state] of userStates.entries()) {
            if (now - state.createdAt > 30 * 60 * 1000) {
                userStates.delete(id);
            }
        }
    }, 5 * 60 * 1000);
    // 1. Generic Message Handler (Links, Onboarding, States)
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text)
            return;
        // BUG-155 Fix: Sanitize logged text to avoid leaking secrets
        const sanitizedText = text.length > 100 ? text.slice(0, 100) + '...' : text;
        logger_1.logger.info(`📩 Incoming from ${chatId} (len=${text.length})`);
        // If it's a command, let onText handle it
        if (text.startsWith('/'))
            return;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || 'uz';
        // A. Onboarding: Capture Target Channel
        if (!user?.target_channel && (text.startsWith('@') || text.startsWith('-100'))) {
            try {
                const chat = await bot.getChat(text);
                const botInfo = await getBotInfo();
                const member = await bot.getChatMember(chat.id, botInfo.id);
                if (member.status === 'administrator' || member.status === 'creator') {
                    await database_1.DBService.updateUser(chatId, { target_channel: text });
                    await database_1.DBService.checkAndMarkReferralActive(chatId);
                    await bot.sendMessage(chatId, "✅ " + i18n_1.i18n.t('onboarding_success', { lng: lang }));
                    return;
                }
                else {
                    await bot.sendMessage(chatId, "❌ Bot ushbu kanalda administrator emas! Iltimos, botni admin qilib qaytadan urinib ko'ring.");
                    return;
                }
            }
            catch (e) {
                await bot.sendMessage(chatId, i18n_1.i18n.t('err_invalid_channel', { lng: lang }));
                return;
            }
        }
        // B. States: Capture Time for Scheduling
        const state = userStates.get(chatId);
        if (state?.type === 'schedule_time') {
            if (msg.text && /^\d{1,2}:\d{2}$/.test(msg.text)) {
                const [h, m] = msg.text.split(':').map(Number);
                if (h < 0 || h > 23 || m < 0 || m > 59) {
                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, "❌ Noto'g'ri vaqt kiritildi. Iltimos 00:00 - 23:59 oraliqda kiriting.");
                }
                const now = new Date();
                const scheduledDate = new Date();
                scheduledDate.setHours(h, m, 0, 0);
                if (scheduledDate <= now)
                    scheduledDate.setDate(scheduledDate.getDate() + 1);
                const mediaType = state.mediaType || 'video';
                const article = await scraper_1.ScraperService.scrapeArticle(state.url).catch(() => null);
                const caption = article?.title ? `🗞 <b>${article.title}</b>\n\n${article.content?.slice(0, 400)}` : "Scheduled Post";
                await database_1.DBService.addScheduledPost(chatId, mediaType, { url: state.url, caption }, scheduledDate.toISOString());
                userStates.delete(chatId);
                const formattedDate = scheduledDate.toLocaleString('uz-UZ', {
                    timeZone: 'Asia/Tashkent',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                await bot.sendMessage(chatId, `✅ <b>Post rejalashtirildi!</b>\n\nSana: ${formattedDate}`, { parse_mode: 'HTML' });
                return;
            }
            userStates.delete(chatId);
            return bot.sendMessage(chatId, "❌ Noto'g'ri format. Iltimos qaytadan boshlang va vaqtni HH:MM formatida kiriting.");
        }
        // D. Admin Broadcast
        // BUG-073 Fix: Check state type specifically and clean up properly
        if (state?.type === 'admin_broadcast' && text) {
            if (user?.role !== 'owner') {
                userStates.delete(chatId);
                return;
            }
            const users = await database_1.DBService.getAllUsers();
            let count = 0;
            await bot.sendMessage(chatId, `⏳ ${users.length} ta foydalanuvchiga yuborilmoqda...`);
            for (const u of users) {
                try {
                    await bot.sendMessage(u.telegram_id, text, { parse_mode: 'HTML' });
                    count++;
                }
                catch { }
            }
            await bot.sendMessage(chatId, `✅ <b>Broadcast yakunlandi!</b>\n\nJami: ${count} ta foydalanuvchiga yuborildi.`, { parse_mode: 'HTML' });
            userStates.delete(chatId);
            return;
        }
        // E. Detect Media Links
        if (msg.text && /youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/.test(msg.text)) {
            const isPlaylist = msg.text.includes('playlist') || msg.text.includes('list=') || msg.text.includes('/sets/');
            const prompt = `📹 <b>${i18n_1.i18n.t('media_detected', { lng: lang }) || 'Media Link Detected!'}</b>\n\n${isPlaylist ? '📝 <b>Playlist aniqlandi!</b>\n\n' : ''}${i18n_1.i18n.t('download_ask', { lng: lang }) || 'Choose format to download:'}`;
            const inline_keyboard = [];
            if (isPlaylist) {
                inline_keyboard.push([{ text: "📥 Ommaviy yuklash (Bulk Download)", callback_data: `dl_playlist_all` }]);
            }
            inline_keyboard.push([
                { text: "📹 Video (MP4)", callback_data: `dl_media_video` },
                { text: "🎵 Audio (MP3)", callback_data: `dl_media_audio` }
            ]);
            inline_keyboard.push([{ text: "📅 Rejalashtirish (Schedule)", callback_data: `schedule_media` }]);
            inline_keyboard.push([{ text: "❌ " + (i18n_1.i18n.t('cancel', { lng: lang }) || 'Cancel'), callback_data: `cancel_dl` }]);
            await bot.sendMessage(chatId, prompt, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
        }
    });
    // 2. Command Handlers
    for (const cmd of exports.commands) {
        bot.onText(cmd.pattern, async (msg, match) => {
            try {
                logger_1.logger.info(`🎯 Pattern Match: ${cmd.pattern} by ${msg.from?.id}`);
                await cmd.handler(bot, msg, match);
            }
            catch (error) {
                logger_1.logger.error(`Error handling ${cmd.pattern}: ${error.message}`);
            }
        });
    }
    // BUG-078 Fix: Pre-checkout query with basic validation
    bot.on('pre_checkout_query', async (query) => {
        try {
            const payload = query.invoice_payload;
            // BUG-078 Fix: Validate payload format
            if (!payload || !payload.startsWith('premium_sub_')) {
                await bot.answerPreCheckoutQuery(query.id, false, { error_message: 'Invalid payment payload' });
                return;
            }
            await bot.answerPreCheckoutQuery(query.id, true);
        }
        catch (e) {
            logger_1.logger.error(`pre_checkout_query error: ${e.message}`);
        }
    });
    // BUG-079 Fix: Robust userId extraction from payload
    bot.on('successful_payment', async (msg) => {
        const chatId = msg.chat.id;
        const payment = msg.successful_payment;
        if (!payment)
            return;
        try {
            const payload = payment.invoice_payload;
            if (payload?.startsWith('premium_sub_')) {
                // BUG-079 Fix: Extract userId more robustly
                const withoutPrefix = payload.replace('premium_sub_', '');
                const isYearly = withoutPrefix.endsWith('_yearly');
                const userIdStr = isYearly ? withoutPrefix.replace('_yearly', '') : withoutPrefix;
                const userId = parseInt(userIdStr);
                if (isNaN(userId)) {
                    logger_1.logger.error(`Invalid userId in payment payload: ${payload}`);
                    return;
                }
                const days = isYearly ? 365 : 30;
                await database_1.DBService.setPremium(userId, days);
                await bot.sendMessage(chatId, "💎 <b>Premium faollashtirildi!</b>\n\nBarcha imkoniyatlardan foydalanishingiz mumkin.", { parse_mode: 'HTML' });
                logger_1.logger.info(`💰 Payment success: User ${userId} bought ${days} days premium.`);
            }
        }
        catch (e) {
            logger_1.logger.error(`successful_payment error: ${e.message}`);
        }
    });
    // 3. Centralized Callback Query Handler
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        if (!chatId || !query.data)
            return;
        const data = query.data;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || 'uz';
        try {
            if (data.startsWith('setlang_')) {
                const newLang = data.split('_')[1];
                const supported = ['uz', 'ru', 'en', 'tr'];
                const langCode = supported.includes(newLang) ? newLang : 'uz';
                await database_1.DBService.updateUser(chatId, { language: langCode, has_seen_lang: true });
                await bot.answerCallbackQuery(query.id, { text: "✅" });
                if (!user?.target_channel) {
                    await bot.sendMessage(chatId, "✅ Til saqlandi!\n\nEndi kanal nomini @belgisi bilan yuboring.\nMasalan: @kanalingiz", { parse_mode: 'HTML' });
                }
                else {
                    const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}`;
                    await bot.sendMessage(chatId, "✅ Til saqlandi! Dashboardga o'tish uchun quyidagi tugmani bosing:", {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[{ text: "🖥 Dashboard", web_app: { url: dashboardUrl } }]]
                        }
                    });
                }
                return;
            }
            else if (data.startsWith('dl_media_')) {
                const type = data === 'dl_media_video' ? 'video' : data === 'dl_media_audio' ? 'audio' : null;
                if (!type) {
                    await bot.answerCallbackQuery(query.id, { text: "❌ Noto'g'ri format", show_alert: true });
                    return;
                }
                // BUG-074 Fix: Extract URL from the original message text (not reply_to)
                let url = query.message?.reply_to_message?.text;
                if (!url) {
                    // Try to find URL in the message that triggered the callback buttons
                    const msgText = query.message?.reply_to_message?.text || '';
                    const urlMatch = msgText.match(/(https?:\/\/[^\s]+)/);
                    if (urlMatch)
                        url = urlMatch[0];
                }
                // BUG-074 Fix: Also check entities for URLs  
                if (!url) {
                    const entities = query.message?.reply_to_message?.entities || [];
                    const text = query.message?.reply_to_message?.text || "";
                    const urlEntity = entities.find((e) => e.type === 'url' || e.type === 'text_link');
                    if (urlEntity) {
                        url = urlEntity.type === 'url' ? text.substring(urlEntity.offset, urlEntity.offset + urlEntity.length) : urlEntity.url;
                    }
                }
                // Last resort: check parent message text
                if (!url)
                    url = query.message?.text?.match(/(https?:\/\/[^\s]+)/)?.[0];
                if (!url) {
                    await bot.answerCallbackQuery(query.id, { text: "❌ Havola topilmadi", show_alert: true });
                    return;
                }
                if (url.includes('soundcloud.com') && type === 'video') {
                    await bot.answerCallbackQuery(query.id, { text: "🎵 SoundCloud faqat Audio (MP3) formatida ishlaydi", show_alert: true });
                    return;
                }
                const waitMsg = await bot.sendMessage(chatId, `⏳ ${i18n_1.i18n.t('processing', { lng: lang })}...`);
                try {
                    const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
                    const filePath = await downloadYouTube(url, type);
                    if (type === 'video')
                        await bot.sendVideo(chatId, filePath);
                    else
                        await bot.sendAudio(chatId, filePath);
                    await bot.deleteMessage(chatId, waitMsg.message_id);
                    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                    if (fs.existsSync(filePath))
                        fs.unlinkSync(filePath);
                }
                catch (err) {
                    await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
                }
            }
            else if (data === 'dl_playlist_all') {
                // BUG-075 Fix: Handle playlist download
                let url = query.message?.reply_to_message?.text?.match(/(https?:\/\/[^\s]+)/)?.[0];
                if (!url)
                    url = query.message?.text?.match(/(https?:\/\/[^\s]+)/)?.[0];
                if (!url) {
                    await bot.answerCallbackQuery(query.id, { text: "❌ Playlist havolasi topilmadi", show_alert: true });
                    return;
                }
                const waitMsg = await bot.sendMessage(chatId, "⏳ Playlist yuklanmoqda...");
                try {
                    const { YoutubeService } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
                    const links = await YoutubeService.extractPlaylistLinks(url, 10);
                    if (links.length === 0) {
                        await bot.editMessageText("❌ Playlist dan videolar topilmadi.", { chat_id: chatId, message_id: waitMsg.message_id });
                        return;
                    }
                    let text = `📝 <b>Playlist (${links.length} ta):</b>\n\n`;
                    links.forEach((l, i) => { text += `${i + 1}. <a href="${l.url}">${l.title}</a>\n`; });
                    await bot.editMessageText(text, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: 'HTML', disable_web_page_preview: true });
                }
                catch (err) {
                    await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
                }
            }
            else if (data === 'schedule_media') {
                const canSchedule = await database_1.DBService.checkUserLimit(chatId, 'scheduled');
                if (!canSchedule)
                    return bot.sendMessage(chatId, "⭐ <b>Limitga yetdingiz!</b>");
                // BUG-076 Fix: Robust URL extraction for scheduling
                let url = query.message?.reply_to_message?.text?.match(/(https?:\/\/[^\s]+)/)?.[0];
                if (!url)
                    url = query.message?.text?.match(/(https?:\/\/[^\s]+)/)?.[0];
                if (!url)
                    return bot.sendMessage(chatId, "❌ Link topilmadi.");
                userStates.set(chatId, { type: 'schedule_time', url, mediaType: 'video', createdAt: Date.now() });
                await bot.sendMessage(chatId, "⏰ <b>Post qachon chiqsin? (SS:DD formatida, masalan: 18:30):</b>", { parse_mode: 'HTML' });
            }
            else if (data === 'cancel_dl') {
                await bot.deleteMessage(chatId, query.message.message_id);
            }
            else if (data === 'cmd_settings') {
                const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}`;
                await bot.sendMessage(chatId, "⚙️ <b>Sozlamalar paneli</b>\n\nDashboard orqali barcha sozlamalarni o'zgartirishingiz mumkin.", {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: "🖥 Dashboard", web_app: { url: dashboardUrl } }]]
                    }
                });
            }
            else if (data === 'cmd_stats') {
                // BUG-077 Fix: Handle cmd_stats callback
                const stats = await database_1.DBService.getStats(chatId);
                await bot.sendMessage(chatId, `📊 <b>Statistika</b>\n\n📈 Postlar: ${stats.total_posts || 0}\n♻️ Dublikatlar: ${stats.total_duplicates || 0}`, { parse_mode: 'HTML' });
            }
            else if (data === 'cmd_referral') {
                // BUG-077 Fix: Handle cmd_referral callback
                const code = await database_1.DBService.ensureReferralCode(chatId);
                const refStats = await database_1.DBService.getReferralStats(chatId);
                const botMe = await getBotInfo();
                const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
                await bot.sendMessage(chatId, `🎁 <b>Referral Tizimi</b>\n\n🔗 Sizning havolangiz:\n<code>${refLink}</code>\n\n👥 Jami: ${refStats.total}\n✅ Aktiv: ${refStats.active}\n⏳ Premiumgacha: ${refStats.needed} ta qoldi`, { parse_mode: 'HTML' });
            }
            else if (data === 'buy_premium') {
                // BUG-077 Fix: Handle buy_premium callback
                const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}`;
                await bot.sendMessage(chatId, "💎 <b>Premium Rejalar</b>\n\nDashboard orqali premium sotib oling.", {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: "🖥 Dashboard", web_app: { url: dashboardUrl } }]]
                    }
                });
            }
            else if (data === 'adm_broadcast') {
                userStates.set(chatId, { type: 'admin_broadcast', url: '', createdAt: Date.now() });
                await bot.sendMessage(chatId, "📢 <b>Broadcast xabarini kiriting (HTML qo'llab-quvvatlanadi):</b>", { parse_mode: 'HTML' });
            }
            await bot.answerCallbackQuery(query.id).catch(() => { });
        }
        catch (e) {
            logger_1.logger.error(`Callback error: ${e.message}`);
            await bot.answerCallbackQuery(query.id).catch(() => { });
        }
    });
}
