import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { CONFIG } from "../config/config";
import { DBService } from "../services/database";

export const adminCommand: BotCommand = {
  pattern: /^\/admin$/,
  description: '⚙️ Admin paneli',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    if (chatId !== CONFIG.OWNER_ID) return;

    const text = `🛠 <b>Admin Boshqaruv Paneli</b>\n\n` +
                 `Quyidagi amallardan birini tanlang:`;
    
    const inline_keyboard = [
      [{ text: "👥 Foydalanuvchilar", callback_data: "adm_users" }],
      [{ text: "💰 Narxlarni sozlash", callback_data: "adm_prices" }],
      [{ text: "📢 Xabar yuborish (Broadcast)", callback_data: "adm_broadcast" }],
    ];

    await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
  }
};
