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
exports.commands = [
    start_1.startCommand,
    status_1.statusCommand,
    track_1.trackCommand,
    admin_1.adminCommand,
];
function registerCommands(bot) {
    const userStates = new Map();
    // 1. Generic Message Handler (Links, Onboarding, States)
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text)
            return;
        logger_1.logger.info(`📩 Incoming: "${text}" from ${chatId}`);
        // If it's a command, let onText handle it (mostly)
        if (text.startsWith('/'))
            return;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || 'uz';
        // A. Onboarding: Capture Target Channel
        if (!user?.target_channel && (text.startsWith('@') || text.startsWith('-100'))) {
            try {
                const chat = await bot.getChat(text);
                const member = await bot.getChatMember(chat.id, (await bot.getMe()).id);
                if (member.status === 'administrator' || member.status === 'creator') {
                    await database_1.DBService.updateUser(chatId, { target_channel: text });
                    await bot.sendMessage(chatId, "✅ " + i18n.t('onboarding_success', { lng: lang }));
                    return;
                }
            }
            catch (e) {
                await bot.sendMessage(chatId, i18n.t('err_invalid_channel', { lng: lang }));
                return;
            }
        }
        // B. States: Capture Time for Scheduling
        const state = userStates.get(chatId);
        if (state?.type === 'schedule_time' && /^\d{2}:\d{2}$/.test(text)) {
            const [h, m] = text.split(':').map(Number);
            const scheduledDate = new Date();
            scheduledDate.setHours(h, m, 0, 0);
            if (scheduledDate < new Date())
                scheduledDate.setDate(scheduledDate.getDate() + 1);
            await database_1.DBService.addScheduledPost(chatId, 'video', { url: state.url, caption: "Scheduled Post" }, scheduledDate.toISOString());
            userStates.delete(chatId);
            await bot.sendMessage(chatId, `✅ <b>Post rejalashtirildi!</b>\n\nSana: ${scheduledDate.toLocaleString()}`, { parse_mode: 'HTML' });
            return;
        }
        // C. Detect Media Links
        if (/youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/.test(text)) {
            const isPlaylist = text.includes('playlist') || text.includes('list=') || text.includes('/sets/');
            const prompt = `📹 <b>${i18n.t('media_detected', { lng: lang }) || 'Media Link Detected!'}</b>\n\n${isPlaylist ? '📝 <b>Playlist aniqlandi!</b>\n\n' : ''}${i18n.t('download_ask', { lng: lang }) || 'Choose format to download:'}`;
            const inline_keyboard = [];
            if (isPlaylist) {
                inline_keyboard.push([{ text: "📥 Ommaviy yuklash (Bulk Download)", callback_data: `dl_playlist_all` }]);
            }
            inline_keyboard.push([
                { text: "📹 Video (MP4)", callback_data: `dl_media_video` },
                { text: "🎵 Audio (MP3)", callback_data: `dl_media_audio` }
            ]);
            inline_keyboard.push([{ text: "📅 Rejalashtirish (Schedule)", callback_data: `schedule_media` }]);
            inline_keyboard.push([{ text: "❌ " + (i18n.t('cancel', { lng: lang }) || 'Cancel'), callback_data: `cancel_dl` }]);
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
                await database_1.DBService.updateUser(chatId, { language: newLang });
                await bot.answerCallbackQuery(query.id, { text: "✅" });
                await bot.sendMessage(chatId, i18n.t('onboarding_success', { lng: newLang }));
            }
            else if (data.startsWith('dl_media_')) {
                const type = data.split('_')[2];
                const url = query.message.reply_to_message?.text || query.message.text;
                const waitMsg = await bot.sendMessage(chatId, `⏳ ${i18n.t('processing', { lng: lang })}`);
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
                const isPremium = await database_1.DBService.isPremiumActive(chatId);
                if (!isPremium) {
                    await bot.sendMessage(chatId, "⭐ <b>Premium kerak!</b>", { parse_mode: 'HTML' });
                    return;
                }
                const url = query.message.reply_to_message?.text || query.message.text;
                const waitMsg = await bot.sendMessage(chatId, `🔍 Playlist tahlil qilinmoqda...`);
                try {
                    const { YoutubeService, downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../services/youtube')));
                    const links = await YoutubeService.extractPlaylistLinks(url, 20);
                    await bot.editMessageText(`✅ ${links.length} ta fayl topildi. Yuklash boshlandi...`, { chat_id: chatId, message_id: waitMsg.message_id });
                    for (const link of links) {
                        const filePath = await downloadYouTube(link.url, 'audio');
                        await bot.sendAudio(chatId, filePath, { caption: link.title });
                        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                        if (fs.existsSync(filePath))
                            fs.unlinkSync(filePath);
                    }
                    await bot.deleteMessage(chatId, waitMsg.message_id);
                }
                catch (err) {
                    await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
                }
            }
            else if (data === 'schedule_media') {
                const canSchedule = await database_1.DBService.checkUserLimit(chatId, 'scheduled');
                if (!canSchedule) {
                    await bot.sendMessage(chatId, "⭐ <b>Limitga yetdingiz!</b>");
                    return;
                }
                const url = query.message.reply_to_message?.text || query.message.text;
                userStates.set(chatId, { type: 'schedule_time', url });
                await bot.sendMessage(chatId, "⏰ <b>Post qachon chiqsin? (SS:DD):</b>", { parse_mode: 'HTML' });
            }
            else if (data === 'cancel_dl') {
                await bot.deleteMessage(chatId, query.message.message_id);
            }
            await bot.answerCallbackQuery(query.id);
        }
        catch (e) {
            logger_1.logger.error(`Callback error: ${e.message}`);
        }
    });
}
