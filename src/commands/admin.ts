import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { isOwnerId } from "../config/config";
import { DBService } from "../services/database";
import { buildDashboardUrl } from "../services/bot_instance";
import { logger } from "../utils/logger";

export const adminCommand: BotCommand = {
  pattern: /^\/(admin|promote)\b/i,
  description: "🛡 Admin Panel & Promotion",
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    try {
      const user = await DBService.getUser(chatId);
      const isOwner = isOwnerId(chatId);

      if (user?.role !== "owner" && user?.role !== "admin" && !isOwner) {
        await bot.sendMessage(chatId, "❌ Bu buyruq faqat adminlar uchun!");
        return;
      }

      const text = msg.text || "";

      if (text.startsWith("/promote")) {
        if (!isOwner) {
          await bot.sendMessage(chatId, "❌ Promote qilish faqat haqiqiy owner (.env dagi) uchun!");
          return;
        }

        const parts = text.split(" ");
        if (parts.length < 3) {
          await bot.sendMessage(chatId, "❓ Ishlatish: <code>/promote [userId] [role]</code>\n\nRollari: admin, premium, user", { parse_mode: "HTML" });
          return;
        }

        const targetId = parseInt(parts[1]);
        if (isNaN(targetId)) {
          await bot.sendMessage(chatId, "❌ Noto'g'ri foydalanuvchi ID!");
          return;
        }

        const role = parts[2].toLowerCase();
        const roles = ["admin", "premium", "user"];
        if (!roles.includes(role)) {
          await bot.sendMessage(chatId, "❌ Noto'g'ri rol! Faqat: " + roles.join(", "));
          return;
        }

        await DBService.updateUserRole(targetId, role);
        await bot.sendMessage(chatId, `✅ Foydalanuvchi <code>${targetId}</code> roli <b>${role.toUpperCase()}</b> ga o'zgartirildi!`, { parse_mode: "HTML" });
        return;
      }

      const allUsers = await DBService.getAllUsers();
      const dashboardUrl = buildDashboardUrl(chatId);

      const report =
        `🛡 <b>Admin Boshqaruv Paneli</b>\n\n` +
        `👥 Jami foydalanuvchilar: <b>${allUsers.length}</b>\n` +
        `🛠 Rolni o'zgartirish: <code>/promote [ID] [ROL]</code>\n\n` +
        `mateAssistent Dashboard orqali to'liq boshqarishingiz mumkin:`;

      const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
      if (dashboardUrl) {
        inline_keyboard.push([{ text: "🖥 mateAssistent Dashboard (Admin Mode)", web_app: { url: dashboardUrl } }]);
      }
      inline_keyboard.push([{ text: "📢 Xabar yuborish (Broadcast)", callback_data: "adm_broadcast" }]);

      await bot.sendMessage(chatId, report, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard },
      });
    } catch (e: unknown) {
      logger.error(`admin command error: ${e instanceof Error ? e.message : String(e)}`);
      await bot.sendMessage(chatId, "❌ Server xatosi yuz berdi.").catch(() => {});
    }
  },
};
