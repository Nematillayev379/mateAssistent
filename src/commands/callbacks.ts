import TelegramBot from "node-telegram-bot-api";
import { DBService } from "../services/database";
import { logger } from "../utils/logger";
import { i18n, WEBAPP_LANGS } from "../services/i18n";
import { CONFIG } from "../config/config";
import { generateDashboardToken } from "../services/bot_instance";
import { PaymentService } from "../services/payment";
import { helpCommand } from "./help";
import { adminCommand } from "./admin";
import { sendNextOnboardingStep } from "./start";

interface UserStateEntry { type: string; url: string; mediaType?: string; sendTarget?: "chat" | "channel"; createdAt: number; }

function buildDashboardUrl(chatId: number): string | null {
  if (!CONFIG.PUBLIC_URL) return null;
  return `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;
}

export async function handleCallbackQuery(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery,
  userStates: Map<number, UserStateEntry>,
) {
  const chatId = query.message?.chat.id;
  if (!chatId || !query.data) return;

  const data = query.data;
  const user = await DBService.getUser(chatId);
  const lang = user?.language || "uz";

  try {
    if (data.startsWith("setlang_")) {
      const newLang = data.split("_")[1];
      const langCode = (WEBAPP_LANGS as readonly string[]).includes(newLang) ? newLang : "uz";
      await DBService.updateUser(chatId, { language: langCode, has_seen_lang: true });

      try {
        await bot.setMyCommands([
          { command: "start", description: `${i18n.t("menu_dashboard", { lng: langCode })} / Boshlash` },
          { command: "status", description: `${i18n.t("menu_stats", { lng: langCode })} / Statistika` },
          { command: "setchannel", description: `${i18n.t("menu_channel", { lng: langCode })} / Kanal sozlash` },
          { command: "track", description: `${i18n.t("menu_referral", { lng: langCode })} / Narx kuzatish` },
          { command: "help", description: `${i18n.t("menu_help", { lng: langCode })} / Yordam` },
        ], { scope: { type: "chat", chat_id: chatId } });
      } catch (e: any) { logger.warn(`setMyCommands error: ${e.message}`); }

      await bot.answerCallbackQuery(query.id, { text: "OK" });
      await bot.sendMessage(chatId, i18n.t("bot_lang_saved", { lng: langCode }));
      await sendNextOnboardingStep(bot, chatId, { ...user, language: langCode, has_seen_lang: true });
      return;
    }

    if (data.startsWith("dl_media_")) {
      await handleMediaDownload(bot, query, chatId, user, lang, userStates, data);
      return;
    }

    if (data === "dl_playlist_all") {
      await handlePlaylist(bot, query, chatId, userStates);
      return;
    }

    if (data === "schedule_media") {
      await handleScheduleMedia(bot, query, chatId, lang, userStates);
      return;
    }

    if (data === "cancel_dl") {
      userStates.delete(chatId);
      await bot.deleteMessage(chatId, query.message!.message_id);
      return;
    }

    if (data === "cmd_settings") {
      const dashUrl = buildDashboardUrl(chatId);
      const inlineKeyboard: TelegramBot.InlineKeyboardButton[][] = [];
      if (dashUrl) inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
      inlineKeyboard.push([{ text: "🌐 Language / Tilni o'zgartirish", callback_data: "cmd_lang" }]);
      await bot.sendMessage(chatId, i18n.t("bot_settings_panel", { lng: lang }), { reply_markup: { inline_keyboard: inlineKeyboard } });
      return;
    }

    if (data === "cmd_lang") {
      const { sendLanguageStep } = await import("./start");
      await sendLanguageStep(bot, chatId);
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    if (data === "cmd_stats" || data === "cmd_analytics") {
      const stats = await DBService.getStats(chatId);
      await bot.sendMessage(chatId, `${i18n.t("bot_stats_title", { lng: lang })}\n\nPosts: ${stats.total_posts || 0}\nDuplicates: ${stats.total_duplicates || 0}`);
      return;
    }

    if (data === "cmd_referral") {
      const code = await DBService.ensureReferralCode(chatId);
      const refStats = await DBService.getReferralStats(chatId);
      const botMe = await bot.getMe();
      const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
      await bot.sendMessage(chatId, `${i18n.t("bot_referral_title", { lng: lang })}\n\n${refLink}\n\nTotal: ${refStats.total}\nActive: ${refStats.active}\nLeft for premium: ${refStats.needed}`);
      return;
    }

    if (data === "buy_premium") {
      await handleBuyPremium(bot, chatId, lang);
      return;
    }

    if (data === "cmd_admin") {
      if (user?.role === "owner" || user?.role === "admin") {
        await adminCommand.handler(bot, query.message as TelegramBot.Message, null);
      } else {
        await bot.answerCallbackQuery(query.id, { text: i18n.t("bot_no_permission", { lng: lang }), show_alert: true });
      }
      return;
    }

    if (data === "adm_broadcast") {
      userStates.set(chatId, { type: "admin_broadcast", url: "", createdAt: Date.now() });
      await bot.sendMessage(chatId, i18n.t("bot_broadcast_prompt", { lng: lang }));
      return;
    }

    if (data === "cmd_sources" || data === "cmd_studio" || data === "cmd_channel" || data === "cmd_automation") {
      const dashUrl = buildDashboardUrl(chatId);
      const inlineKeyboard: TelegramBot.InlineKeyboardButton[][] = [];
      if (dashUrl) inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
      await bot.sendMessage(chatId, i18n.t("bot_open_dashboard", { lng: lang }), { reply_markup: { inline_keyboard: inlineKeyboard } });
      return;
    }

    if (data === "cmd_help") {
      await helpCommand.handler(bot, query.message as TelegramBot.Message, null);
      return;
    }

    await bot.answerCallbackQuery(query.id).catch(() => {});
  } catch (e: any) {
    logger.error(`Callback error: ${e.message}`);
    await bot.answerCallbackQuery(query.id).catch(() => {});
  }
}

async function handleMediaDownload(
  bot: TelegramBot, query: TelegramBot.CallbackQuery, chatId: number, user: any, lang: string,
  userStates: Map<number, UserStateEntry>, data: string,
) {
  const type = data.includes("_video_") ? "video" : data.includes("_audio_") ? "audio" : null;
  const sendTarget: "chat" | "channel" = data.endsWith("_channel") ? "channel" : "chat";
  if (!type) {
    await bot.answerCallbackQuery(query.id, { text: "Invalid format", show_alert: true });
    return;
  }

  const url = resolveMediaUrl(query, userStates, chatId);
  if (!url) {
    await bot.answerCallbackQuery(query.id, { text: "Link not found", show_alert: true });
    return;
  }

  if (sendTarget === "channel" && !user?.target_channel) {
    await bot.answerCallbackQuery(query.id, { text: i18n.t("bot_target_missing", { lng: lang }), show_alert: true });
    return;
  }

  const waitMsg = await bot.sendMessage(chatId, i18n.t("processing", { lng: lang }));
  try {
    const { downloadYouTube } = await import("../services/youtube");
    const filePath = await downloadYouTube(url, type);
    const deliveryTarget = sendTarget === "channel" ? user!.target_channel : chatId;
    if (type === "video") await bot.sendVideo(deliveryTarget, filePath);
    else await bot.sendAudio(deliveryTarget, filePath);
    await bot.deleteMessage(chatId, waitMsg.message_id);
    if (sendTarget === "channel") {
      await bot.sendMessage(chatId, i18n.t("bot_media_sent_channel", { lng: lang }));
    }
    const fs = await import("fs");
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    userStates.delete(chatId);
  } catch (err: any) {
    logger.error(`Media download error: ${err.message}`);
    await bot.editMessageText(`Error occurred while downloading media.`, { chat_id: chatId, message_id: waitMsg.message_id });
  }
}

async function handlePlaylist(
  bot: TelegramBot, query: TelegramBot.CallbackQuery, chatId: number, userStates: Map<number, UserStateEntry>,
) {
  const url = resolveMediaUrl(query, userStates, chatId);
  if (!url) {
    await bot.answerCallbackQuery(query.id, { text: "Playlist link not found", show_alert: true });
    return;
  }

  const waitMsg = await bot.sendMessage(chatId, "Playlist loading...");
  try {
    const { YoutubeService } = await import("../services/youtube");
    const links = await YoutubeService.extractPlaylistLinks(url, 10);
    if (links.length === 0) {
      await bot.editMessageText("No videos found in the playlist.", { chat_id: chatId, message_id: waitMsg.message_id });
      return;
    }
    let text = `Playlist (${links.length})\n\n`;
    links.forEach((link, index) => { text += `${index + 1}. ${link.title}\n${link.url}\n\n`; });
    await bot.editMessageText(text, { chat_id: chatId, message_id: waitMsg.message_id, disable_web_page_preview: true });
  } catch (err: any) {
    logger.error(`Playlist extract error: ${err.message}`);
    await bot.editMessageText(`Error loading playlist.`, { chat_id: chatId, message_id: waitMsg.message_id });
  }
}

async function handleScheduleMedia(
  bot: TelegramBot, query: TelegramBot.CallbackQuery, chatId: number, lang: string,
  userStates: Map<number, UserStateEntry>,
) {
  const canSchedule = await DBService.checkUserLimit(chatId, "scheduled");
  if (!canSchedule) {
    await bot.sendMessage(chatId, "Scheduling limit reached.");
    return;
  }

  const url = resolveMediaUrl(query, userStates, chatId);
  if (!url) {
    await bot.sendMessage(chatId, "Link not found.");
    return;
  }

  userStates.set(chatId, { type: "schedule_time", url, mediaType: "video", createdAt: Date.now() });
  await bot.sendMessage(chatId, i18n.t("bot_schedule_prompt", { lng: lang }));
}

async function handleBuyPremium(bot: TelegramBot, chatId: number, lang: string) {
  const monthlyPrice = await DBService.getPrice("monthly");
  const yearlyPrice = await DBService.getPrice("yearly");
  const paymeLink = await PaymentService.generatePaymeLink(chatId, monthlyPrice);
  const clickLink = await PaymentService.generateClickLink(chatId, monthlyPrice);

  const dashUrl = buildDashboardUrl(chatId);
  const text = `${i18n.t("bot_premium_title", { lng: lang })}\n\nMonthly: ${monthlyPrice.toLocaleString()} UZS\nYearly: ${yearlyPrice.toLocaleString()} UZS`;
  const inlineKeyboard: TelegramBot.InlineKeyboardButton[][] = [
    [{ text: `Payme (${monthlyPrice.toLocaleString()} UZS)`, url: paymeLink || "https://payme.uz" }],
    [{ text: `Click (${monthlyPrice.toLocaleString()} UZS)`, url: clickLink || "https://click.uz" }],
  ];
  if (dashUrl) inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);

  await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
}

export function resolveMediaUrl(query: TelegramBot.CallbackQuery, userStates: Map<number, UserStateEntry>, chatId: number): string | null {
  const pending = userStates.get(chatId);
  if (pending?.url && (pending.type === "media_download" || pending.type === "schedule_time")) return pending.url;

  const msg = query.message as any;
  const replyText = msg?.reply_to_message?.text || "";
  const match = replyText.match(/(https?:\/\/[^\s]+)/);
  if (match) return match[0];

  const fromMessage = msg?.text?.match(/(https?:\/\/[^\s]+)/);
  if (fromMessage) return fromMessage[0];

  const entities = msg?.reply_to_message?.entities || [];
  const urlEntity = entities.find((e: any) => e.type === "url" || e.type === "text_link");
  if (!urlEntity) return null;
  if (urlEntity.type === "url") return replyText.substring(urlEntity.offset, urlEntity.offset + urlEntity.length);
  return urlEntity.url;
}
