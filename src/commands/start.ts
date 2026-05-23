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
  const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];

  if (dashboardUrl) {
    inline_keyboard.push([
      { text: i18n.t("menu_dashboard", { lng: lang }), web_app: { url: dashboardUrl } }
    ]);
  }

  inline_keyboard.push(
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
    ],
  );

  if (role === "owner" || role === "admin") {
    inline_keyboard.unshift([{ text: i18n.t("menu_admin", { lng: lang }), callback_data: "cmd_admin" }]);
  }

  if (role === "user" && !user.is_premium) {
    inline_keyboard.push([{ text: i18n.t("menu_buy_premium", { lng: lang }), callback_data: "buy_premium" }]);
  }

  const menuText = dashboardUrl
    ? i18n.t("onboarding_menu_ready", { lng: lang })
    : `${i18n.t("onboarding_menu_ready", { lng: lang })}\n\nDashboard hozircha ulanmagan. Admin PUBLIC_URL ni sozlashi kerak.`;

  await bot.sendMessage(chatId, menuText, {
    reply_markup: { inline_keyboard },
  });
}

export async function sendLanguageStep(bot: TelegramBot, chatId: number): Promise<void> {
  const premiumIntro =
    `\u{1F916} <b>mateAssistent Creator Console</b>\n` +
    `<i>The Ultimate Web3 Automator for Telegram Creators</i>\n\n` +
    `\u26A1\ufe0f <b>Core Automation Features:</b>\n` +
    `\u2022 \u{1F4E1} <b>RSS Feed Aggregator:</b> Auto-publish from website feeds.\n` +
    `\u2022 \u{1F9E0} <b>Smart AI Post Engine:</b> Auto-translate, summarize, and add emojis.\n` +
    `\u2022 \u{1F3A8} <b>AI Image Studio:</b> Create stunning high-res matching illustrations.\n` +
    `\u2022 \u{1F4E5} <b>Universal Downloader:</b> Fetch social videos/audio in high quality.\n` +
    `\u2022 \u{1F4D3} <b>Scheduler & Cadence:</b> Smart queuing and customized interval times.\n` +
    `\u2022 \u{1F4CA} <b>Real-time Analytics:</b> Track click rates, duplicates, and top categories.\n\n` +
    `\u{1F310} <b>Choose your language to start / Tilni tanlang / \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0437\u044b\u043a:</b>`;

  await bot.sendMessage(chatId, premiumIntro, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: getLanguageKeyboard() }
  });
}

async function sendChannelStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `\u{1F4E1} <b>Qadam 1/3: Kanal ulang</b>\n\n${i18n.t("onboarding_channel_title", { lng: lang })}\n\n${i18n.t("onboarding_channel_body", { lng: lang })}`,
    { parse_mode: "HTML" }
  );
}

async function sendSourceStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `\u{1F4E1} <b>Qadam 2/3: Manba qo\u02BBshing</b>\n\n${i18n.t("onboarding_rss_title", { lng: lang })}\n\n${i18n.t("onboarding_rss_body", { lng: lang })}`,
    { parse_mode: "HTML" }
  );
}

async function sendIntervalStep(bot: TelegramBot, chatId: number, lang: string): Promise<void> {
  await bot.sendMessage(
    chatId,
    `\u{23F0} <b>Qadam 3/3: Intervalni tanlang</b>\n\n${i18n.t("onboarding_interval_title", { lng: lang })}\n\n${i18n.t("onboarding_interval_body", { lng: lang })}`,
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
              const msg = `🎉 ${referrer.telegram_id === chatId ? '' : 'Someone joined via your link!'}\nActive referrals: ${refCount}`;
              if (refCount > 0 && refCount % 10 === 0) {
                await DBService.checkAndGivePremium(referrer.telegram_id);
              }
              await bot.sendMessage(referrer.telegram_id, msg);
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
      await DBService.updateUser(chatId, { is_approved: 1 }).catch(() => {});
      user.is_approved = 1;
    }

    await sendNextOnboardingStep(bot, chatId, user);
  },
};
