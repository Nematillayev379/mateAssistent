import TelegramBot from "node-telegram-bot-api";
import { startCommand } from "./start";
import { statusCommand } from "./status";
import { trackCommand } from "./track";
import { adminCommand } from "./admin";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { logger } from "../utils/logger";

export const commands: BotCommand[] = [
  startCommand,
  statusCommand,
  trackCommand,
  adminCommand,
];

export function registerCommands(bot: TelegramBot) {
  // Global logger for debug
  bot.on('message', (msg) => {
    if (msg.text) {
      logger.info(`📩 Incoming message: "${msg.text}" from ${msg.chat.id}`);
    }
  });

  for (const cmd of commands) {
    bot.onText(cmd.pattern, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
      try {
        logger.info(`🎯 Command triggered: ${cmd.pattern} by ${msg.text}`);
        await cmd.handler(bot, msg, match);
      } catch (error: any) {
        logger.error(`Error handling command ${cmd.pattern}: ${error.message}`);
      }
    });
  }

  // --- Callback Query Handler (Buttons) ---
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const data = query.data;

    try {
      if (data === 'cmd_stats') {
        await statusCommand.handler(bot, query.message as any, null);
      } else if (data === 'cmd_lang') {
        const langs = [
          ['🇺🇿 O\'zbek', 'ru_🇷🇺 Русский', 'en_🇺🇸 English'],
          ['tr_🇹🇷 Türkçe', 'de_🇩🇪 Deutsch', 'fr_🇫🇷 Français'],
          ['es_🇪🇸 Español', 'it_🇮🇹 Italiano', 'pt_🇵🇹 Português'],
          ['ar_🇸🇦 العربية', 'hi_🇮🇳 हिन्दी', 'zh_🇨🇳 中文'],
          ['ja_🇯🇵 日本語', 'ko_🇰🇷 한국어', 'fa_🇮🇷 فارسی']
        ];
        const keyboard = langs.map(row => row.map(l => {
          const [code, label] = l.includes('_') ? l.split('_') : [l.toLowerCase().substring(0,2), l];
          return { text: label, callback_data: `setlang_${code === 'uz' ? 'uz' : code}` };
        }));
        await bot.sendMessage(chatId, "🌍 <b>Select your language / Tilni tanlang:</b>", {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else if (data?.startsWith('setlang_')) {
        const newLang = data.split('_')[1];
        await DBService.updateUser(chatId, { language: newLang });
        await bot.answerCallbackQuery(query.id, { text: `Language set to ${newLang}!` });
        await bot.sendMessage(chatId, `✅ Language updated! Press /start to refresh.`);
      }
      
      await bot.answerCallbackQuery(query.id);
    } catch (e: any) {
      logger.error(`Callback error: ${e.message}`);
    }
  });
}
