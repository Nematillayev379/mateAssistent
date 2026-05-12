"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = void 0;
const database_1 = require("../services/database");
const config_1 = require("../config/config");
const i18n_1 = require("../services/i18n");
exports.startCommand = {
    pattern: /start|boshlash|начать/i,
    description: '🏠 Botni boshlash / Start',
    handler: async (bot, msg, match) => {
        const chatId = msg.chat.id;
        const isOwner = chatId === config_1.CONFIG.OWNER_ID;
        const user = await database_1.DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
        const lang = user?.language || 'uz';
        // 1. Check Onboarding State
        if (!user.target_channel) {
            const text = i18n_1.i18n.t('onboarding_welcome', { lng: lang }) + "\n\n" + i18n_1.i18n.t('onboarding_ask_channel', { lng: lang });
            await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
            return;
        }
        if (!user.language) {
            const text = i18n_1.i18n.t('onboarding_ask_lang', { lng: lang });
            const inline_keyboard = [
                [{ text: "🇺🇿 O'zbek", callback_data: "set_lang_uz" }, { text: "🇷🇺 Русский", callback_data: "set_lang_ru" }],
                [{ text: "🇺🇸 English", callback_data: "set_lang_en" }, { text: "🇹🇷 Türkçe", callback_data: "set_lang_tr" }]
            ];
            await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            return;
        }
        // 2. Main Dashboard (if onboarding complete)
        const token = config_1.CONFIG.DASHBOARD_SECRET;
        const dashUrl = config_1.CONFIG.PUBLIC_URL ? `${config_1.CONFIG.PUBLIC_URL}/?user_id=${chatId}&token=${token}` : null;
        const welcomeText = i18n_1.i18n.t('onboarding_success', { lng: lang });
        const inline_keyboard = [];
        if (dashUrl) {
            inline_keyboard.push([{ text: `🚀 ${i18n_1.i18n.t('nav_dashboard', { lng: lang })}`, web_app: { url: dashUrl } }]);
        }
        inline_keyboard.push([{ text: "⚙️ Settings", callback_data: "cmd_settings" }]);
        await bot.sendMessage(chatId, welcomeText, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard }
        });
    }
};
