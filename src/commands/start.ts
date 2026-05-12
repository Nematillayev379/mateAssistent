import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";

const EMOJI = {
  warning: "⚠️",
  info: "ℹ️",
};

export const startCommand: BotCommand = {
  pattern: /^\/start(?: (.+))?$/,
  description: '🏠 Botni boshlash',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const param = match?.[1]?.trim();
    const isOwner = chatId === CONFIG.OWNER_ID;
    
    const user = await DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);

    if (param?.startsWith('ref_') && user) {
      const refCode = param.replace('ref_', '');
      const alreadyReferred = await DBService.hasReferral(chatId);

      if (!alreadyReferred) {
        const referrer = await DBService.getUserByReferralCode(refCode);
        if (referrer && referrer.telegram_id !== chatId) {
          await DBService.createReferral(referrer.telegram_id, chatId);
          try {
            const stats = await DBService.getReferralStats(referrer.telegram_id);
            await bot.sendMessage(
              referrer.telegram_id,
              `🎉 <b>Yangi tavsiya!</b>\n\n` +
              `Sizning havolangiz orqali yangi foydalanuvchi qo'shildi!\n\n` +
              `📊 Faol tavsiyalar: <b>${stats.active}</b>/10\n` +
              `🎯 Premiumga yana: <b>${stats.needed}</b> ta tavsiya kerak\n\n` +
              `<i>10 ta faol foydalanuvchi chaqirganingizda 1 oylik Premium beriladi!</i>`,
              { parse_mode: 'HTML' }
            );
          } catch {}
        }
      }
    }

    const token = CONFIG.DASHBOARD_SECRET;
    const dashUrl = CONFIG.PUBLIC_URL ? `${CONFIG.PUBLIC_URL}?user_id=${chatId}&token=${token}` : null;

    if (user && user.is_approved) {
      const text = `🌐 <b>Newsroom Web3 Ecosystem [V10.1]</b>\n\n` +
                   `Tizim muvaffaqiyatli yangilandi! ✅\n\n` +
                   `🚀 <b>Imkoniyatlar:</b>\n` +
                   `• Manbalarni boshqarish 📰\n` +
                   `• AI Xizmatlar & DApps 🛠\n` +
                   `• Shaxsiy statistika 📊\n` +
                   `• Referral tizimi 🎁\n\n` +
                   `<i>Tugmani bosing va ekotizimga kiring:</i>`;
      
      const bannerUrl = "https://image.pollinations.ai/prompt/futuristic%20web3%20news%20dashboard%20interface%20neon%20blue?width=800&height=400&nologo=true";
      
      const inline_keyboard = dashUrl ? [[{ text: "🚀 Terminal Dashboard", web_app: { url: dashUrl } }]] : [];

      try {
        await bot.sendPhoto(chatId, bannerUrl, {
          caption: text,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard }
        });
      } catch {
        await bot.sendMessage(chatId, text, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard }
        });
      }
    } else {
      const adminUser = (await DBService.getSetting('admin_username')) || '@admin';
      const text = `${EMOJI.warning} <b>Siz hali tasdiqlanmagansiz.</b>\n\n` +
                   `Lekin xavotir olmang! Sizda <b>24 soatlik BEPUL trial</b> muddati mavjud.\n\n` +
                   `Tasdiqlash uchun admin bilan bog'laning: ${adminUser}`;
      
      await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
    }
  }
};
