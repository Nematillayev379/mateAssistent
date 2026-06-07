import TelegramBot from "node-telegram-bot-api";
import { DBService } from "../services/database";
import { ScraperService } from "../services/scraper";
import { i18n } from "../services/i18n";
import { sendNextOnboardingStep } from "./start";

export async function handleOnboardingMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  user: { has_seen_lang?: boolean; target_channel?: string; interval_minutes?: number | string },
  lang: string,
): Promise<boolean> {
  if (!user.has_seen_lang) {
    const { sendLanguageStep } = await import("./start");
    await sendLanguageStep(bot, chatId);
    return true;
  }

  if (!user.target_channel) {
    await handleChannelStep(bot, chatId, text, lang);
    return true;
  }

  const sources = user.target_channel ? await DBService.getUserSources(chatId) : [];
  if (user.target_channel && sources.length === 0) {
    await handleRssStep(bot, chatId, text, lang);
    return true;
  }

  if (user.target_channel && sources.length > 0 && (!user.interval_minutes || Number(user.interval_minutes) < 1)) {
    await handleIntervalStep(bot, chatId, text, lang);
    return true;
  }

  return false;
}

async function handleChannelStep(bot: TelegramBot, chatId: number, text: string, lang: string) {
  let targetText = text.trim();
  if (targetText.includes("t.me/")) {
    const parts = targetText.split("t.me/");
    const handle = parts[parts.length - 1].split("/")[0].trim();
    if (handle) targetText = `@${handle}`;
  }
  if (!targetText.startsWith("@") && !targetText.startsWith("-100") && /^[a-zA-Z0-9_]{5,32}$/.test(targetText)) {
    targetText = `@${targetText}`;
  }

  if (!targetText.startsWith("@") && !targetText.startsWith("-100")) {
    await bot.sendMessage(chatId, i18n.t("setchannel_missing", { lng: lang }));
    return;
  }

  try {
    const channelChat = await bot.getChat(targetText);
    const botInfo = await bot.getMe();
    const member = await bot.getChatMember(channelChat.id, botInfo.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      await bot.sendMessage(chatId, i18n.t("setchannel_not_admin", { lng: lang }));
      return;
    }

    const saved = await DBService.updateUser(chatId, { target_channel: targetText });
    if (!saved) {
      await bot.sendMessage(chatId, i18n.t("setchannel_save_failed_db", { lng: lang }));
      return;
    }

    await DBService.checkAndMarkReferralActive(chatId);
    await bot.sendMessage(chatId, i18n.t("setchannel_success", { lng: lang }));
    await sendNextOnboardingStep(bot, chatId);
  } catch {
    await bot.sendMessage(chatId, i18n.t("setchannel_error", { lng: lang }));
  }
}

async function handleRssStep(bot: TelegramBot, chatId: number, text: string, lang: string) {
  const trimmed = text.trim();
  let websiteInput = extractUrl(trimmed);
  if (!websiteInput) {
    const compact = trimmed.replace(/\s+/g, "");
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(compact)) {
      websiteInput = `https://${compact}`;
    } else if (/^[a-zA-Z0-9-]{2,}$/.test(compact)) {
      websiteInput = `https://${compact}.uz`;
    }
  }

  if (!websiteInput) {
    await bot.sendMessage(chatId, `${i18n.t("onboarding_rss_body", { lng: lang })}\n\n${i18n.t("onboarding_rss_website_hint", { lng: lang })}`, { parse_mode: "HTML" });
    return;
  }

  if (!/^https?:\/\//i.test(websiteInput)) websiteInput = `https://${websiteInput}`;
  if (!(await ScraperService.isPublicExternalUrl(websiteInput))) {
    await bot.sendMessage(chatId, i18n.t("err_invalid_url", { lng: lang }));
    return;
  }

  const rssUrl = isLikelyRssUrl(websiteInput) ? websiteInput : await ScraperService.discoverRSS(websiteInput);
  if (!rssUrl) {
    await bot.sendMessage(chatId, i18n.t("onboarding_rss_not_found", { lng: lang }));
    return;
  }

  const ok = await DBService.addSource(chatId, "Primary RSS", rssUrl, lang);
  if (!ok) {
    await bot.sendMessage(chatId, i18n.t("err_invalid_url", { lng: lang }));
    return;
  }
  await bot.sendMessage(chatId, `${i18n.t("quick_source_saved", { lng: lang })}\n\nRSS: ${rssUrl}`);
  await sendNextOnboardingStep(bot, chatId);
}

async function handleIntervalStep(bot: TelegramBot, chatId: number, text: string, lang: string) {
  const minutes = Number(text.trim());
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    await bot.sendMessage(chatId, i18n.t("quick_invalid_interval", { lng: lang }));
    return;
  }
  await DBService.updateUser(chatId, { interval_minutes: minutes });
  await bot.sendMessage(chatId, i18n.t("quick_interval_saved", { lng: lang }));
  await sendNextOnboardingStep(bot, chatId);
}

function extractUrl(text: string): string | null {
  const match = text.match(/(https?:\/\/[^\s]+)/);
  return match ? match[0] : null;
}

function isLikelyRssUrl(url: string): boolean {
  return /rss|feed|xml|atom/i.test(url);
}
