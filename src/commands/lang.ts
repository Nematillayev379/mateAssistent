import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { sendLanguageStep } from "./start";

export const langCommand: BotCommand = {
  pattern: /^\/(lang|language|til|язык)$/i,
  description: "🌐 Tilni o'zgartirish / Change language",
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    await sendLanguageStep(bot, chatId);
  },
};
