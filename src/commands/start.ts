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

function buildDashboardUrl(chatId: number): string {
  return `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;
}

async function sendWelcomeMenu(
  bot: TelegramBot,
  chatId: number,
  user: { is_premium?: number | boolean; language?: string },
  role: string
): Promise<void> {
  const lang = user.language || "uz";
  const dashboardUrl = buildDashboardUrl(chatId);
  const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: i18n.t("menu_dashboard", { lng: lang }), web_app: { url: dashboardUrl } }],
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
    [{ text: i18n.t("menu_help", { lng: lang }), callback_data: "cmd_help" }],
  ];

  if (role === "owner" || role === "admin") {
    inline_keyboard.unshift([{ text: i18n.t("menu_admin", { lng: lang }), callback_data: "cmd_admin" }]);
  }

  if (role === "user" && !user.is_premium) {
    inline_keyboard.push([{ text: i18n.t("menu_buy_premium", { lng: lang }), callback_data: "buy_premium" }]);
  }

  await bot.sendMessage(chatId, i18n.t("onboarding_menu_ready", { lng: lang }), {
    reply_markup: { inline_keyboard },
  });
}

export async function sendLanguageStep(bot: TelegramBot, chatId: number): Promise<void> {
  const premiumIntro = 
    `🤖 <b>mateAssistent Creator Console</b>\n` +
    `<i>The Ultimate Web3 Automator for Telegram Creators</i>\n\n` +
    `⚡️ <b>Core Automation Features:</b>\n` +
    `• 📡 <b>RSS Feed Aggregator:</b> Auto-publish from website feeds.\n` +
    `• 🧠 <b>Smart AI Post Engine:</b> Auto-translate, summarize, and add emojis.\n` +
    `• 🎨 <b>AI Image Studio:</b> Create stunning high-res matching illustrations.\n` +
    `• 📥 <b>Universal Downloader:</b> Fetch social videos/audio in high quality.\n` +
    `• 📅 <b>Scheduler & Cadence:</b> Smart queuing and customized interval times.\n` +
    `• 📊 <b>Real-time Analytics:</b> Track click rates, duplicates, and top categories.\n\n` +
    `🌐 <b>Choose your language to start / Tilni tanlang / Выберите язык:</b>`;

  await bot.sendMessage(chatId, premiumIntro, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: getLanguageKeyboard() }
  });
}

async function sendChannelStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `${i18n.t("onboarding_channel_title", { lng: lang })}\n\n${i18n.t("onboarding_channel_body", { lng: lang })}`
  );
}

async function sendSourceStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `${i18n.t("onboarding_rss_title", { lng: lang })}\n\n${i18n.t("onboarding_rss_body", { lng: lang })}`
  );
}

async function sendIntervalStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `${i18n.t("onboarding_interval_title", { lng: lang })}\n\n${i18n.t("onboarding_interval_body", { lng: lang })}`
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

  await sendWelcomeMenu(bot, chatId, user, user.role || "user");
  return "menu";
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
              await bot.sendMessage(referrer.telegram_id, "New referral joined from your link.");
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

    if (!user.is_approved && !isOwner && user.role !== "admin" && user.role !== "owner") {
      await bot.sendMessage(
        chatId,
        "Your profile is waiting for approval. An admin can unlock access soon."
      );
      return;
    }

    await sendNextOnboardingStep(bot, chatId, user);
  },
};
