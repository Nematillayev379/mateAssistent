"use strict";
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
    // Global logger for debug
    bot.on('message', (msg) => {
        if (msg.text) {
            logger_1.logger.info(`📩 Incoming message: "${msg.text}" from ${msg.chat.id}`);
        }
    });
    for (const cmd of exports.commands) {
        bot.onText(cmd.pattern, async (msg, match) => {
            try {
                logger_1.logger.info(`🎯 Command triggered: ${cmd.pattern} by ${msg.text}`);
                await cmd.handler(bot, msg, match);
            }
            catch (error) {
                logger_1.logger.error(`Error handling command ${cmd.pattern}: ${error.message}`);
            }
        });
    }
    // --- Callback Query Handler (Buttons) ---
    bot.on('callback_query', async (query) => {
        const chatId = query.message?.chat.id;
        if (!chatId)
            return;
        const data = query.data;
        try {
            if (data === 'cmd_stats') {
                await status_1.statusCommand.handler(bot, query.message, null);
            }
            else if (data === 'cmd_lang') {
                const langs = [
                    ['🇺🇿 O\'zbek', 'ru_🇷🇺 Русский', 'en_🇺🇸 English'],
                    ['tr_🇹🇷 Türkçe', 'de_🇩🇪 Deutsch', 'fr_🇫🇷 Français'],
                    ['es_🇪🇸 Español', 'it_🇮🇹 Italiano', 'pt_🇵🇹 Português'],
                    ['ar_🇸🇦 العربية', 'hi_🇮🇳 हिन्दी', 'zh_🇨🇳 中文'],
                    ['ja_🇯🇵 日本語', 'ko_🇰🇷 한국어', 'fa_🇮🇷 فارسی']
                ];
                const keyboard = langs.map(row => row.map(l => {
                    const [code, label] = l.includes('_') ? l.split('_') : [l.toLowerCase().substring(0, 2), l];
                    return { text: label, callback_data: `setlang_${code === 'uz' ? 'uz' : code}` };
                }));
                await bot.sendMessage(chatId, "🌍 <b>Select your language / Tilni tanlang:</b>", {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }
            else if (data?.startsWith('setlang_')) {
                const newLang = data.split('_')[1];
                await database_1.DBService.updateUser(chatId, { language: newLang });
                await bot.answerCallbackQuery(query.id, { text: `Language set to ${newLang}!` });
                await bot.sendMessage(chatId, `✅ Language updated! Press /start to refresh.`);
            }
            await bot.answerCallbackQuery(query.id);
        }
        catch (e) {
            logger_1.logger.error(`Callback error: ${e.message}`);
        }
    });
}
