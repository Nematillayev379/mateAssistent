import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { sendLanguageStep } from "./start";
import { logger } from "../utils/logger";

export const langCommand: BotCommand = {
  pattern: /^\/(lang|language|til|язык)$/i,
  description: "🌐 Tilni o'zgartirish / Change language",
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    try {
      await sendLanguageStep(bot, chatId);
    } catch (e: unknown) {
      logger.error(`lang command error: ${e instanceof Error ? e.message : String(e)}`);
      await bot.sendMessage(chatId, "❌ Xatolik yuz berdi.").catch(() => {});
    }
  },
};
