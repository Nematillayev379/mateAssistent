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
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || 'uz';
        if (query.data.startsWith('set_lang_')) {
            const newLang = query.data.replace('set_lang_', '');
            await database_1.DBService.updateUser(chatId, { language: newLang });
            await bot_instance_1.bot.answerCallbackQuery(query.id, { text: "✅" });
            await bot_instance_1.bot.sendMessage(chatId, i18n_1.i18n.t('onboarding_success', { lng: newLang }));
            return;
        }
        if (query.data.startsWith('dl_media_')) {
            const parts = query.data.split('_');
            const type = parts[2];
            const url = query.message.reply_to_message?.text || query.message.text;
            if (!url || !url.startsWith('http')) {
                await bot_instance_1.bot.sendMessage(chatId, i18n_1.i18n.t('err_invalid_url', { lng: lang }) || "❌ Noto'g'ri havola");
                return;
            }
            const waitMsg = await bot_instance_1.bot.sendMessage(chatId, `⏳ ${i18n_1.i18n.t('processing', { lng: lang }) || 'Processing...'}`);
            try {
                const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('./youtube')));
                const filePath = await downloadYouTube(url, type);
                if (type === 'video') {
                    await bot_instance_1.bot.sendVideo(chatId, filePath);
                }
                else {
                    await bot_instance_1.bot.sendAudio(chatId, filePath);
                }
                await bot_instance_1.bot.deleteMessage(chatId, waitMsg.message_id);
                // Cleanup file
                const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                if (fs.existsSync(filePath))
                    fs.unlinkSync(filePath);
            }
            catch (err) {
                await bot_instance_1.bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
            }
        }
        else if (query.data === 'dl_playlist_all') {
            const canDownload = await database_1.DBService.checkUserLimit(chatId, 'scheduled'); // Using 'scheduled' as a proxy for bulk for now
            const isPremium = await database_1.DBService.isPremiumActive(chatId);
            if (!isPremium) {
                await bot_instance_1.bot.sendMessage(chatId, "⭐ <b>Premium kerak!</b>\n\nOmmaviy yuklash faqat Premium foydalanuvchilar uchun ochiq.", { parse_mode: 'HTML' });
                return;
            }
            const url = query.message.reply_to_message?.text || query.message.text;
            const waitMsg = await bot_instance_1.bot.sendMessage(chatId, `🔍 Playlist tahlil qilinmoqda...`);
            try {
                const { YoutubeService } = await Promise.resolve().then(() => __importStar(require('./youtube')));
                const links = await YoutubeService.extractPlaylistLinks(url, 20);
                if (links.length === 0)
                    throw new Error("Playlist bo'sh yoki havolalarni olishda xatolik");
                await bot_instance_1.bot.editMessageText(`✅ ${links.length} ta fayl topildi. Yuklash boshlandi...`, { chat_id: chatId, message_id: waitMsg.message_id });
                const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('./youtube')));
                const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                for (const link of links) {
                    try {
                        const filePath = await downloadYouTube(link.url, 'audio');
                        await bot_instance_1.bot.sendAudio(chatId, filePath, { caption: link.title });
                        if (fs.existsSync(filePath))
                            fs.unlinkSync(filePath);
                    }
                    catch (e) {
                        await bot_instance_1.bot.sendMessage(chatId, `❌ Error (${link.title}): ${e.message}`);
                    }
                }
                await bot_instance_1.bot.deleteMessage(chatId, waitMsg.message_id);
            }
            catch (err) {
                await bot_instance_1.bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
            }
        }
        else if (query.data === 'schedule_media') {
            const canSchedule = await database_1.DBService.checkUserLimit(chatId, 'scheduled');
            if (!canSchedule) {
                await bot_instance_1.bot.sendMessage(chatId, "⭐ <b>Limitga yetdingiz!</b>\n\nBepul foydalanuvchilar faqat 3 ta rejalashtirilgan postga ega bo'lishi mumkin. Premiumga o'ting.");
                return;
            }
            const url = query.message.reply_to_message?.text || query.message.text;
            userStates.set(chatId, { type: 'schedule_time', url });
            await bot_instance_1.bot.sendMessage(chatId, "⏰ <b>Post qachon chiqsin?</b>\n\nVaqtni SS:DD formatida yuboring (Masalan: 09:00 yoki 18:30):", { parse_mode: 'HTML' });
        }
        else if (query.data === 'cancel_dl') {
            try {
                await bot_instance_1.bot.deleteMessage(chatId, query.message.message_id);
            }
            catch { }
        }
        await bot_instance_1.bot.answerCallbackQuery(query.id);
    });
    // ── GENERIC MESSAGE HANDLER (Links, Music, etc.) ─────────────────
    bot_instance_1.bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/'))
            return;
        const chatId = msg.chat.id;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || 'uz';
        // 2. Onboarding: Capture Target Channel
        if (!user?.target_channel && msg.text && (msg.text.startsWith('@') || msg.text.startsWith('-100'))) {
            try {
                const chat = await bot_instance_1.bot.getChat(msg.text);
                const member = await bot_instance_1.bot.getChatMember(chat.id, (await bot_instance_1.bot.getMe()).id);
                if (member.status === 'administrator' || member.status === 'creator') {
                    await database_1.DBService.updateUser(chatId, { target_channel: msg.text });
                    await bot_instance_1.bot.sendMessage(chatId, "✅ " + i18n_1.i18n.t('onboarding_success', { lng: lang }));
                    return;
                }
            }
            catch (e) {
                await bot_instance_1.bot.sendMessage(chatId, i18n_1.i18n.t('err_invalid_channel', { lng: lang }));
                return;
            }
        }
        // 3. Scheduling: Capture Time
        const state = userStates.get(chatId);
        if (state?.type === 'schedule_time' && msg.text && /^\d{2}:\d{2}$/.test(msg.text)) {
            const [h, m] = msg.text.split(':').map(Number);
            const scheduledDate = new Date();
            scheduledDate.setHours(h, m, 0, 0);
            // If time passed, schedule for tomorrow
            if (scheduledDate < new Date())
                scheduledDate.setDate(scheduledDate.getDate() + 1);
            await database_1.DBService.addScheduledPost(chatId, 'video', { url: state.url, caption: "Scheduled Post" }, scheduledDate.toISOString());
            userStates.delete(chatId);
            await bot_instance_1.bot.sendMessage(chatId, `✅ <b>Post rejalashtirildi!</b>\n\nSana: ${scheduledDate.toLocaleString()}`, { parse_mode: 'HTML' });
            return;
        }
        // Detect YouTube/Instagram/TikTok links
        if (/youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/.test(msg.text)) {
            const isPlaylist = msg.text.includes('playlist') || msg.text.includes('list=') || msg.text.includes('/sets/');
            const text = `📹 <b>${i18n_1.i18n.t('media_detected', { lng: lang }) || 'Media Link Detected!'}</b>\n\n${isPlaylist ? '📝 <b>Playlist aniqlandi!</b>\n\n' : ''}${i18n_1.i18n.t('download_ask', { lng: lang }) || 'Choose format to download:'}`;
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
