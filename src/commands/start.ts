import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { CONFIG } from "../config/config";
import { i18n } from "../services/i18n";
import { logger } from "../utils/logger";
import { generateDashboardToken } from "../services/bot_instance";

export const startCommand: BotCommand = {
  pattern: /start\s*(.*)|boshlash\s*(.*)|начать\s*(.*)/i,
  description: '🏠 Botni boshlash / Start',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const isOwner = chatId === CONFIG.OWNER_ID;
    
    // Bug #24: Referral System Fix
    const payload = match?.[1] || match?.[2] || match?.[3];
    if (payload && payload.startsWith('ref_')) {
      const referrerCode = payload.replace('ref_', '').trim();
      const referrer = await DBService.getUserByReferralCode(referrerCode);
      if (referrer && referrer.telegram_id !== chatId) {
        const isNewUser = !(await DBService.getUser(chatId));
        if (isNewUser) {
           await DBService.createReferral(referrer.telegram_id, chatId);
           logger.info(`🎁 New referral: ${chatId} invited by ${referrer.telegram_id}`);
           await bot.sendMessage(referrer.telegram_id, "🎁 <b>Yangi referral!</b> Sizga bonus berildi.");
        }
      }
    }

    const user = await DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
    // BUG #46 Fix: handle null user
    if (!user) return;
    
    const lang = user.language || 'uz';
    const role = user.role || 'user';

    // BUG #83 Fix: Check if user is approved
    if (!user.is_approved && !isOwner && role !== 'admin') {
      await bot.sendMessage(chatId, "⏳ <b>Sizning profilingiz hali tasdiqlanmagan.</b>\n\nAdminlar tasdiqlaganidan so'ng botdan foydalanishingiz mumkin.");
      return;
    }

    // Let's keep it simple: if target_channel is missing, show onboarding steps.
    if (!user.target_channel) {
       if (!user.has_seen_lang) { // We'll add this to user record or just use language === 'uz' as a proxy for 'new'
          const text = "🌍 <b>Welcome! Please choose your language:</b>\n\n<i>Salom! Tilni tanlang:</i>";
          const inline_keyboard = [
            [{ text: "🇺🇿 O'zbek", callback_data: "setlang_uz" }, { text: "🇷🇺 Русский", callback_data: "setlang_ru" }],
            [{ text: "🇺🇸 English", callback_data: "setlang_en" }, { text: "🇹🇷 Türkçe", callback_data: "setlang_tr" }]
          ];
          await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          await DBService.updateUser(chatId, { has_seen_lang: true }); // We should add this column
          return;
       }

       const text = "🗞 <b>So'nggi qadam!</b>\n\nYangiliklar qaysi kanalga yuborilsin? Kanal nomini @belgisi bilan yuboring (Masalan: @kanalingiz).\n\n<i>Eslatma: Botni kanalingizga 'Admin' qilishingiz shart!</i>";
       await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
       return;
    }

    // 3. Elite Welcome Experience
    const welcomeMsg = {
      owner: "👑 <b>Xush kelibsiz, Janob Owner!</b>\n\nTizim 100% sizning nazoratingizda. Admin panel orqali foydalanuvchilarni boshqarishingiz mumkin.",
      admin: "🛠 <b>Admin Panelga xush kelibsiz!</b>\n\nSupport so'rovlarini ko'rib chiqish va botni boshqarish uchun dashboardga o'ting.",
      premium: "🚀 <b>Siz Premium foydalanuvchisiz!</b>\n\nBarcha cheklovlar olib tashlangan. Ommaviy yuklash va AI media xizmatlaridan foydalanishingiz mumkin.",
      user: "🗞 <b>Newsroom Botga xush kelibsiz!</b>\n\nDunyo yangiliklarini avtomatik ravishda kanalingizga joylab boring."
    }[role as 'owner' | 'admin' | 'premium' | 'user'] || "👋 Salom!";

    // Bug #27 Fix: Per-user token for IDOR protection
    const token = generateDashboardToken(chatId);
    const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?user=${chatId}&token=${token}`;

    const inline_keyboard: any[][] = [
      [{ text: "🖥 Elite Dashboard", web_app: { url: dashboardUrl } }],
      [{ text: "⚙️ Sozlamalar", callback_data: 'cmd_settings' }, { text: "📊 Statistika", callback_data: 'cmd_stats' }],
      [{ text: "🎁 Referral Tizimi", callback_data: 'cmd_referral' }]
    ];

    if (role === 'user' && !user.is_premium) {
      inline_keyboard.push([{ text: "💎 Premium Sotib Olish", callback_data: 'buy_premium' }]);
    }

    await bot.sendMessage(chatId, welcomeMsg + `\n\n🔑 <b>Dashboard Kalitingiz:</b> <code>${token}</code>\n\n<i>Kalitni nusxalab oling va Dashboardga kirishda foydalaning.</i>`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard }
    });
  }
};
