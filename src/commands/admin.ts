import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { CONFIG, isOwnerId } from "../config/config";
import { DBService } from "../services/database";
import { generateDashboardToken } from "../services/bot_instance";

export const adminCommand: BotCommand = {
  // BUG-087 Fix: Require leading slash to prevent false matches
  pattern: /^\/(admin|promote)\b/i,
  description: '🛡 Admin Panel & Promotion',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    const isOwner = isOwnerId(chatId);
    
    // BUG-087 Fix: Allow both owner and admin to see the panel, but owner-only for sensitive actions
    if (user?.role !== 'owner' && user?.role !== 'admin' && !isOwner) {
      await bot.sendMessage(chatId, "❌ Bu buyruq faqat Adminlar uchun!");
      return;
    }

    const text = msg.text || "";
    
    // Logic for /promote [userId] [role]
    if (text.startsWith('/promote')) {
      // BUG-088 Fix: Strictly restrict promotion to the OWNER_ID defined in .env
      if (!isOwner) {
        await bot.sendMessage(chatId, "❌ Promote qilish faqat haqiqiy Owner (.env dagi) uchun!");
        return;
      }

      const parts = text.split(' ');
      // BUG-088 Fix: Proper validation for parts
      if (parts.length < 3) {
        await bot.sendMessage(chatId, "❓ Ishlatish: <code>/promote [userId] [role]</code>\n\nRollari: admin, premium, user", { parse_mode: 'HTML' });
        return;
      }
      const targetId = parseInt(parts[1]);
      if (isNaN(targetId)) {
        await bot.sendMessage(chatId, "❌ Noto'g'ri foydalanuvchi ID!");
        return;
      }
      const role = parts[2].toLowerCase();
      
      // BUG-089 Fix: Removed 'owner' from assignable roles
      const roles = ['admin', 'premium', 'user'];
      if (!roles.includes(role)) {
        await bot.sendMessage(chatId, "❌ Noto'g'ri rol! Faqat: " + roles.join(', '));
        return;
      }

      await DBService.updateUserRole(targetId, role);
      await bot.sendMessage(chatId, `✅ Foydalanuvchi <code>${targetId}</code> roli <b>${role.toUpperCase()}</b> ga o'zgartirildi!`, { parse_mode: 'HTML' });
      return;
    }

    // Default Admin View
    const allUsers = await DBService.getAllUsers();
    // BUG-090 Fix: Include token in dashboard URL
    const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}`;

    const report = `🛡 <b>Admin Boshqaruv Paneli</b>\n\n` +
                   `👥 Jami foydalanuvchilar: <b>${allUsers.length}</b>\n` +
                   `🛠 Rolni o'zgartirish: <code>/promote [ID] [ROL]</code>\n\n` +
                   `Elite Dashboard orqali to'liq boshqarishingiz mumkin:`;

    await bot.sendMessage(chatId, report, { 
      parse_mode: 'HTML', 
      reply_markup: {
        inline_keyboard: [
          [{ text: "🖥 Elite Dashboard (Admin Mode)", web_app: { url: dashboardUrl } }],
          [{ text: "📢 Xabar yuborish (Broadcast)", callback_data: "adm_broadcast" }]
        ]
      }
    });
  }
};
