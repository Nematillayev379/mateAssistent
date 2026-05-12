import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { CONFIG } from "../config/config";
import { i18n } from "../services/i18n";
import { logger } from "../utils/logger";

export const startCommand: BotCommand = {
  pattern: /start|boshlash|начать/i,
  description: '🏠 Botni boshlash / Start',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const isOwner = chatId === CONFIG.OWNER_ID;
    
    const user = await DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
    const lang = user?.language || 'uz';

    // 1. Check Onboarding State
    if (!user.target_channel) {
       const text = i18n.t('onboarding_welcome', { lng: lang }) + "\n\n" + i18n.t('onboarding_ask_channel', { lng: lang });
       await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
       return;
    }

    if (!user.language) {
       const text = i18n.t('onboarding_ask_lang', { lng: lang });
       const inline_keyboard = [
         [{ text: "🇺🇿 O'zbek", callback_data: "set_lang_uz" }, { text: "🇷🇺 Русский", callback_data: "set_lang_ru" }],
         [{ text: "🇺🇸 English", callback_data: "set_lang_en" }, { text: "🇹🇷 Türkçe", callback_data: "set_lang_tr" }]
       ];
       await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
       return;
    }

    // 2. Main Dashboard (if onboarding complete)
    const token = CONFIG.DASHBOARD_SECRET;
    const dashUrl = CONFIG.PUBLIC_URL ? `${CONFIG.PUBLIC_URL}/?user_id=${chatId}&token=${token}` : null;
    
    const welcomeText = i18n.t('onboarding_success', { lng: lang });
    const inline_keyboard: any[][] = [];
    if (dashUrl) {
      inline_keyboard.push([{ text: `🚀 ${i18n.t('nav_dashboard', { lng: lang })}`, web_app: { url: dashUrl } }]);
    }
    inline_keyboard.push([{ text: "⚙️ Settings", callback_data: "cmd_settings" }]);

    await bot.sendMessage(chatId, welcomeText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard }
    });
  }
};
