import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { isOwnerId } from "../config/config";
import { buildDashboardUrl } from "../services/bot_instance";
import { i18n, WEBAPP_LANGS } from "../services/i18n";
import { logger } from "../utils/logger";

function getLanguageKeyboard(): TelegramBot.InlineKeyboardButton[][] {
  const labels: Record<string, string> = {
    uz: "O'zbek",
    ru: "Russian",
    en: "English",
    tr: "Turkish",
    de: "Deutsch",
    fr: "French",
    es: "Spanish",
    it: "Italiano",
    pt: "Portuguese",
    ar: "Arabic",
    hi: "Hindi",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    fa: "Persian",
    kk: "Kazakh",
    az: "Azerbaijani",
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
  const dashboardUrl = buildDashboardUrl(chatId);
  const inlineKeyboard: TelegramBot.InlineKeyboardButton[][] = [];

  if (dashboardUrl) {
    inlineKeyboard.push([{ text: i18n.t("menu_dashboard", { lng: lang }), web_app: { url: dashboardUrl } }]);
  }

  inlineKeyboard.push(
    [
      { text: i18n.t("menu_sources", { lng: lang }), callback_data: "cmd_sources" },
      { text: i18n.t("menu_studio", { lng: lang }), callback_data: "cmd_studio" },
    ],
    [
      { text: i18n.t("menu_channel", { lng: lang }), callback_data: "cmd_channel" },
      { text: i18n.t("menu_automation", { lng: lang }), callback_data: "cmd_automation" },
    ],
    [
      { text: i18n.t("menu_analytics", { lng: lang }), callback_data: "cmd_stats" },
      { text: i18n.t("menu_settings", { lng: lang }), callback_data: "cmd_settings" },
    ],
    [
      { text: i18n.t("menu_help", { lng: lang }), callback_data: "cmd_help" },
      { text: i18n.t("menu_intro", { lng: lang }), url: `${process.env.PUBLIC_URL || ""}/intro/` },
    ]
  );

  if (role === "owner" || role === "admin") {
    inlineKeyboard.unshift([{ text: i18n.t("menu_admin", { lng: lang }), callback_data: "cmd_admin" }]);
  }

  if (role === "user" && !user.is_premium) {
    inlineKeyboard.push([{ text: i18n.t("menu_buy_premium", { lng: lang }), callback_data: "buy_premium" }]);
  }

  const menuText = dashboardUrl
    ? i18n.t("onboarding_menu_ready", { lng: lang })
    : `${i18n.t("onboarding_menu_ready", { lng: lang })}\n\n${i18n.t("no_dashboard_configured", { lng: lang })}`;

  await bot.sendMessage(chatId, menuText, { reply_markup: { inline_keyboard: inlineKeyboard } });
}

export async function sendLanguageStep(bot: TelegramBot, chatId: number): Promise<void> {
  const introText =
    `🤖 <b>${i18n.t("start_intro_title", { lng: "en" })}</b>\n` +
    `<i>${i18n.t("start_intro_subtitle", { lng: "en" })}</i>\n\n` +
    `⚡️ <b>${i18n.t("start_intro_features_title", { lng: "en" })}</b>\n` +
    `\n• 📡 <b>${i18n.t("start_feature_rss_label", { lng: "en" })}:</b> ${i18n.t("start_feature_rss", { lng: "en" })}` +
    `\n• 🧠 <b>${i18n.t("start_feature_ai_label", { lng: "en" })}:</b> ${i18n.t("start_feature_ai", { lng: "en" })}` +
    `\n• 🎨 <b>${i18n.t("start_feature_image_label", { lng: "en" })}:</b> ${i18n.t("start_feature_image", { lng: "en" })}` +
    `\n• 📥 <b>${i18n.t("start_feature_downloader_label", { lng: "en" })}:</b> ${i18n.t("start_feature_downloader", { lng: "en" })}` +
    `\n• 📓 <b>${i18n.t("start_feature_scheduler_label", { lng: "en" })}:</b> ${i18n.t("start_feature_scheduler", { lng: "en" })}` +
    `\n• 📊 <b>${i18n.t("start_feature_analytics_label", { lng: "en" })}:</b> ${i18n.t("start_feature_analytics", { lng: "en" })}` +
    `\n\n🌐 <b>${i18n.t("start_choose_language", { lng: "en" })}</b>`;

  await bot.sendMessage(chatId, introText, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: getLanguageKeyboard() },
  });
}

async function sendChannelStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `📡 <b>${i18n.t("onboarding_step_channel", { lng: lang })}</b>\n\n${i18n.t("onboarding_channel_title", { lng: lang })}\n\n${i18n.t("onboarding_channel_body", { lng: lang })}`,
    { parse_mode: "HTML" }
  );
}

async function sendSourceStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `📡 <b>${i18n.t("onboarding_step_source", { lng: lang })}</b>\n\n${i18n.t("onboarding_rss_title", { lng: lang })}\n\n${i18n.t("onboarding_rss_body", { lng: lang })}`,
    { parse_mode: "HTML" }
  );
}

async function sendIntervalStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `⏰ <b>${i18n.t("onboarding_step_interval", { lng: lang })}</b>\n\n${i18n.t("onboarding_interval_title", { lng: lang })}\n\n${i18n.t("onboarding_interval_body", { lng: lang })}`,
    { parse_mode: "HTML" }
  );
}

export async function sendNextOnboardingStep(
  bot: TelegramBot,
  chatId: number,
  userOverride?: any
): Promise<"language" | "channel" | "source" | "interval" | "menu"> {
  const user = userOverride || (await DBService.getUser(chatId));
  if (!user) return "language";

  const lang = user.language || "uz";
  const sources = await DBService.getUserSources(chatId);

  if (!user.has_seen_lang) {
    await sendLanguageStep(bot, chatId);
    return "language";
  }
  if (!user.target_channel) {
    await sendChannelStep(bot, chatId, lang);
    return "channel";
  }
  if (!sources.length) {
    await sendSourceStep(bot, chatId, lang);
    return "source";
  }
  if (!user.interval_minutes || Number(user.interval_minutes) < 1) {
    await sendIntervalStep(bot, chatId, lang);
    return "interval";
  }

  await DBService.checkAndMarkReferralActive(chatId).catch(() => {});
  await sendWelcomeMenu(bot, chatId, user, user.role || "user");
  return "menu";
}

export const startCommand: BotCommand = {
  pattern: /\/start\s*(.*)|\/boshlash\s*(.*)|\/\u043d\u0430\u0447\u0430\u0442\u044c\s*(.*)/i,
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
            await DBService.setPremium(chatId, 3);
            logger.info(`New referral: ${chatId} invited by ${referrer.telegram_id}, 3d premium granted`);
            try {
              const refCount = (await DBService.getReferralStats(referrer.telegram_id)).active;
              const refLang = referrer.language || "en";
              const refMsg = `🎉 ${i18n.t("referral_joined", { lng: refLang })}\n${i18n.t("referral_active_count", { lng: refLang })} ${refCount}`;
              if (refCount > 0 && refCount % 10 === 0) {
                await DBService.checkAndGivePremium(referrer.telegram_id);
              }
              await bot.sendMessage(referrer.telegram_id, refMsg);
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

    const requireApproval = (await DBService.getSetting("require_approval")) === "1";
    if (!requireApproval && !user.is_approved && !isOwner && user.role !== "admin" && user.role !== "owner") {
      await DBService.updateUser(chatId, { is_approved: 1 }).catch(() => {});
      user.is_approved = 1;
    }
    if (requireApproval && !user.is_approved && !isOwner && user.role !== "admin" && user.role !== "owner") {
      try {
        await bot.sendMessage(chatId, i18n.t("approval_pending", { lng: user.language || "uz" }));
      } catch {
        logger.warn(`Failed to send approval message to ${chatId}`);
      }
      return;
    }

    await sendNextOnboardingStep(bot, chatId, user);
  },
};
