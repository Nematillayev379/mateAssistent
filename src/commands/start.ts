import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { CONFIG, isOwnerId } from "../config/config";
import { generateDashboardToken } from "../services/bot_instance";
import { i18n, WEBAPP_LANGS } from "../services/i18n";
import { logger } from "../utils/logger";

function getLanguageKeyboard(): TelegramBot.InlineKeyboardButton[][] {
  const labels: Record<string, string> = {
    uz: "O'zbek",
    ru: "Русский",
    en: "English",
    tr: "Türkçe",
    de: "Deutsch",
    fr: "Français",
    es: "Español",
    it: "Italiano",
    pt: "Português",
    ar: "العربية",
    hi: "हिन्दी",
    zh: "中文",
    ja: "日本語",
    ko: "한국어",
    fa: "فارسی",
  };

  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < WEBAPP_LANGS.length; i += 2) {
    rows.push(
      WEBAPP_LANGS.slice(i, i + 2).map((lang) => ({
        text: labels[lang],
        callback_data: `setlang_${lang}`,
      }))
    );
  }
  return rows;
}

async function sendWelcomeMenu(
  bot: TelegramBot,
  chatId: number,
  user: { is_premium?: number | boolean; language?: string },
  role: string
): Promise<void> {
  const lang = user.language || "uz";
  const welcomeMsg: string = {
    owner: `👑 <b>${i18n.t("welcome_owner", { lng: lang })}</b>`,
    admin: `🛡 <b>${i18n.t("welcome_admin", { lng: lang })}</b>`,
    premium: `🚀 <b>${i18n.t("welcome_premium", { lng: lang })}</b>`,
    user: `🗞 <b>${i18n.t("welcome_user", { lng: lang })}</b>`,
  }[role as "owner" | "admin" | "premium" | "user"] || "👋";

  const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;
  const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: `🖥 ${i18n.t("menu_dashboard", { lng: lang })}`, web_app: { url: dashboardUrl } }],
    [
      { text: `⚙️ ${i18n.t("menu_settings", { lng: lang })}`, callback_data: "cmd_settings" },
      { text: `📊 ${i18n.t("menu_stats", { lng: lang })}`, callback_data: "cmd_stats" },
    ],
    [{ text: `🎁 ${i18n.t("menu_referral", { lng: lang })}`, callback_data: "cmd_referral" }],
  ];

  if (role === "owner" || role === "admin") {
    inline_keyboard.unshift([{ text: `🛡 ${i18n.t("menu_admin", { lng: lang })}`, callback_data: "cmd_admin" }]);
  }

  if (role === "user" && !user.is_premium) {
    inline_keyboard.push([{ text: `💎 ${i18n.t("menu_buy_premium", { lng: lang })}`, callback_data: "buy_premium" }]);
  }

  await bot.sendMessage(
    chatId,
    `${welcomeMsg}\n\n<i>${i18n.t("bot_settings_panel", { lng: lang })}</i>`,
    { parse_mode: "HTML", reply_markup: { inline_keyboard } }
  );
}

export const startCommand: BotCommand = {
  pattern: /\/start\s*(.*)|\/boshlash\s*(.*)|\/начать\s*(.*)/i,
  description: "Botni boshlash / Start",
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const isOwner = isOwnerId(chatId);

    const payload = (match?.[1] || match?.[2] || match?.[3] || "").trim();
    if (payload && payload.startsWith("ref_")) {
      const referrerCode = payload.replace("ref_", "").trim();
      const referrer = await DBService.getUserByReferralCode(referrerCode);
      if (referrer && referrer.telegram_id !== chatId) {
        const isNewUser = !(await DBService.getUser(chatId));
        if (isNewUser) {
          const created = await DBService.createReferral(referrer.telegram_id, chatId);
          if (created) {
            logger.info(`New referral: ${chatId} invited by ${referrer.telegram_id}`);
            try {
              await bot.sendMessage(referrer.telegram_id, "🎁 <b>Yangi referral!</b> Sizga bonus berildi.", { parse_mode: "HTML" });
            } catch (e: any) {
              logger.warn(`Could not notify referrer ${referrer.telegram_id}: ${e.message}`);
            }
          }
        }
      }
    }

    const user = await DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
    if (!user) return;

    if (isOwner && user.role !== "owner") {
      await DBService.updateUserRole(chatId, "owner");
      user.role = "owner";
    }

    const role = user.role || "user";

    if (!user.is_approved && !isOwner && role !== "admin" && role !== "owner") {
      await bot.sendMessage(
        chatId,
        "⏳ <b>Sizning profilingiz hali tasdiqlanmagan.</b>\n\nAdminlar tasdiqlaganidan so'ng botdan foydalanishingiz mumkin.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const isStaff = isOwner || role === "owner" || role === "admin";
    const dashboardUrl = `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;

    if (!user.target_channel) {
      if (!user.has_seen_lang) {
        const inline_keyboard = getLanguageKeyboard();
        if (isStaff) {
          inline_keyboard.push([
            { text: "🛡 Admin Panel", callback_data: "cmd_admin" },
            { text: "🖥 Dashboard", web_app: { url: dashboardUrl } },
          ]);
        }
        await bot.sendMessage(
          chatId,
          `🌍 <b>${i18n.t("bot_choose_language", { lng: "en" })}</b>\n\n<i>${i18n.t("bot_choose_language", { lng: "uz" })}</i>`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard } }
        );
        await DBService.updateUser(chatId, { has_seen_lang: true });
        if (isStaff) {
          await sendWelcomeMenu(bot, chatId, user, role);
        }
        return;
      }

      const lang = user.language || "uz";
      await bot.sendMessage(
        chatId,
        `🗞 <b>${i18n.t("bot_last_step", { lng: lang })}</b>\n\n${i18n.t("bot_send_channel_example", { lng: lang })}\n\n<i>${i18n.t("bot_channel_hint", { lng: lang })}</i>`,
        { parse_mode: "HTML" }
      );
      if (isStaff) {
        await sendWelcomeMenu(bot, chatId, user, role);
      }
      return;
    }

    await sendWelcomeMenu(bot, chatId, user, role);
  },
};
