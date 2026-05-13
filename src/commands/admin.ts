import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { CONFIG } from "../config/config";
import { DBService } from "../services/database";

export const adminCommand: BotCommand = {
  pattern: /admin|promote/i,
  description: '🛡 Admin Panel & Promotion',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    
    // Only owner can promote
    if (user?.role !== 'owner' && chatId !== CONFIG.OWNER_ID) {
      await bot.sendMessage(chatId, "❌ Bu buyruq faqat Owner uchun!");
      return;
    }

    const text = msg.text || "";
    
    // Logic for /promote [userId] [role]
    if (text.startsWith('/promote')) {
      const parts = text.split(' ');
      if (parts.length < 3) {
        await bot.sendMessage(chatId, "❓ Ishlatish: <code>/promote [userId] [role]</code>\n\nRollari: admin, premium, owner, user", { parse_mode: 'HTML' });
        return;
      }
      const targetId = parseInt(parts[1]);
      const role = parts[2].toLowerCase();
      
      const roles = ['admin', 'premium', 'owner', 'user'];
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
    const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?user=${chatId}`;

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
