import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { CONFIG, isOwnerId } from "../config/config";
import { generateDashboardToken } from "../services/bot_instance";
import { logger } from "../utils/logger";

async function sendWelcomeMenu(
  bot: TelegramBot,
  chatId: number,
  user: { is_premium?: number | boolean },
  role: string
): Promise<void> {
  const welcomeMsg: string = {
    owner: "👑 <b>Xush kelibsiz, Janob Owner!</b>\n\nTizim sizning nazoratingizda. Admin panel orqali foydalanuvchilarni boshqaring.",
    admin: "🛠 <b>Admin Panelga xush kelibsiz!</b>\n\nDashboard orqali botni boshqaring.",
    premium: "🚀 <b>Siz Premium foydalanuvchisiz!</b>\n\nBarcha cheklovlar olib tashlangan.",
    user: "🗞 <b>Newsroom Botga xush kelibsiz!</b>\n\nYangiliklarni avtomatik kanalingizga joylab boring."
  }[role as 'owner' | 'admin' | 'premium' | 'user'] || "👋 Salom!";

  const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;
  const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: "🖥 Elite Dashboard", web_app: { url: dashboardUrl } }],
    [{ text: "⚙️ Sozlamalar", callback_data: 'cmd_settings' }, { text: "📊 Statistika", callback_data: 'cmd_stats' }],
    [{ text: "🎁 Referral Tizimi", callback_data: 'cmd_referral' }]
  ];

  if (role === 'owner' || role === 'admin') {
    inline_keyboard.unshift([{ text: "🛡 Admin Panel", callback_data: 'cmd_admin' }]);
  }

  if (role === 'user' && !user.is_premium) {
    inline_keyboard.push([{ text: "💎 Premium Sotib Olish", callback_data: 'buy_premium' }]);
  }

  await bot.sendMessage(
    chatId,
    welcomeMsg + `\n\n<i>Dashboard orqali barcha sozlamalarni boshqaring.</i>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard } }
  );
}

export const startCommand: BotCommand = {
  pattern: /\/start\s*(.*)|\/boshlash\s*(.*)|\/начать\s*(.*)/i,
  description: '🏠 Botni boshlash / Start',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const isOwner = isOwnerId(chatId);
    
    // BUG-083 Fix: Referral before upsert to catch new users
    const payload = (match?.[1] || match?.[2] || match?.[3] || '').trim();
    if (payload && payload.startsWith('ref_')) {
      const referrerCode = payload.replace('ref_', '').trim();
      const referrer = await DBService.getUserByReferralCode(referrerCode);
      if (referrer && referrer.telegram_id !== chatId) {
        const isNewUser = !(await DBService.getUser(chatId));
        if (isNewUser) {
           // BUG-022 Fix: createReferral checks for duplicates internally
           const created = await DBService.createReferral(referrer.telegram_id, chatId);
           if (created) {
             logger.info(`🎁 New referral: ${chatId} invited by ${referrer.telegram_id}`);
             // BUG-084 Fix: Wrap in try/catch for blocked users
             try {
               await bot.sendMessage(referrer.telegram_id, "🎁 <b>Yangi referral!</b> Sizga bonus berildi.", { parse_mode: 'HTML' });
             } catch (e: any) {
               logger.warn(`Could not notify referrer ${referrer.telegram_id}: ${e.message}`);
             }
           }
        }
      }
    }

    const user = await DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
    if (!user) return;

    if (isOwner && user.role !== 'owner') {
      await DBService.updateUserRole(chatId, 'owner');
      user.role = 'owner';
    }
    
    const role = user.role || 'user';

    // BUG-083 Fix: Check if user is approved
    if (!user.is_approved && !isOwner && role !== 'admin' && role !== 'owner') {
      await bot.sendMessage(chatId, "⏳ <b>Sizning profilingiz hali tasdiqlanmagan.</b>\n\nAdminlar tasdiqlaganidan so'ng botdan foydalanishingiz mumkin.", { parse_mode: 'HTML' });
      return;
    }

    const isStaff = isOwner || role === 'owner' || role === 'admin';
    const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;

    if (!user.target_channel) {
       if (!user.has_seen_lang) {
          const text = "🌍 <b>Welcome! Please choose your language:</b>\n\n<i>Salom! Tilni tanlang:</i>";
          const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [
            [{ text: "🇺🇿 O'zbek", callback_data: "setlang_uz" }, { text: "🇷🇺 Русский", callback_data: "setlang_ru" }],
            [{ text: "🇺🇸 English", callback_data: "setlang_en" }, { text: "🇹🇷 Türkçe", callback_data: "setlang_tr" }]
          ];
          if (isStaff) {
            inline_keyboard.push([
              { text: "🛡 Admin Panel", callback_data: 'cmd_admin' },
              { text: "🖥 Dashboard", web_app: { url: dashboardUrl } },
            ]);
          }
          await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          await DBService.updateUser(chatId, { has_seen_lang: true });
          if (isStaff) {
            await sendWelcomeMenu(bot, chatId, user, role);
          }
          return;
       }

       const text = "🗞 <b>So'nggi qadam!</b>\n\nYangiliklar qaysi kanalga yuborilsin? Kanal nomini @belgisi bilan yuboring (Masalan: @kanalingiz).\n\n<i>Eslatma: Botni kanalingizga 'Admin' qilishingiz shart!</i>";
       await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
       if (isStaff) {
         await sendWelcomeMenu(bot, chatId, user, role);
       }
       return;
    }

    await sendWelcomeMenu(bot, chatId, user, role);
  }
};
