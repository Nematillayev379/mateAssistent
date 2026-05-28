import TelegramBot from "node-telegram-bot-api";
import { helpCommand } from "./help";
import { adminCommand } from "./admin";
import { setChannelCommand } from "./setchannel";
import { statusCommand } from "./status";
import { trackCommand } from "./track";
import { workspaceCommand } from "./workspace";
import { sendNextOnboardingStep, startCommand } from "./start";
import { langCommand } from "./lang";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { logger } from "../utils/logger";
import { i18n } from "../services/i18n";
import { CONFIG } from "../config/config";
import { ScraperService } from "../services/scraper";
import { generateDashboardToken } from "../services/bot_instance";
import { checkRateLimit } from "../services/rate_limiter";
import { handleCallbackQuery, resolveMediaUrl } from "./callbacks";
import { handleOnboardingMessage } from "./onboarding";

export const commands: BotCommand[] = [
  startCommand,
  statusCommand,
  trackCommand,
  workspaceCommand,
  adminCommand,
  setChannelCommand,
  helpCommand,
  langCommand,
];

export interface UserStateEntry {
  type: string;
  url: string;
  mediaType?: string;
  sendTarget?: "chat" | "channel";
  createdAt: number;
}

let cachedBotInfo: TelegramBot.User | null = null;

function extractUrlFromText(text: string): string | null {
  const match = text.match(/(https?:\/\/[^\s]+)/);
  return match ? match[0] : null;
}

export function registerCommands(bot: TelegramBot) {
  const userStates = new Map<number, UserStateEntry>();

  const getBotInfo = async () => {
    if (!cachedBotInfo) cachedBotInfo = await bot.getMe();
    return cachedBotInfo;
  };

  // Clean stale user states every 60s (10-min TTL)
  setInterval(() => {
    const now = Date.now();
    for (const [id, state] of userStates.entries()) {
      if (now - state.createdAt > 10 * 60 * 1000) userStates.delete(id);
    }
  }, 60_000);

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || chatId;
    if (!await checkRateLimit(userId)) {
      logger.warn(`Rate limited message from ${userId}`);
      return;
    }

    if (!chatId) return;
    const text = msg.text;
    if (!text) return;

    logger.info(`Incoming from ${chatId} (len=${text.length})`);
    if (text.startsWith("/")) return;

    const user = await DBService.getUser(chatId);
    const lang = user?.language || "uz";
    const state = userStates.get(chatId);

    // Onboarding flow
    if (user && await handleOnboardingMessage(bot, chatId, text, user, lang)) return;

    if (state?.type === "schedule_time") {
      if (/^\d{1,2}:\d{2}$/.test(text)) {
        const [h, m] = text.split(":").map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
          userStates.delete(chatId);
          await bot.sendMessage(chatId, i18n.t("bot_invalid_time", { lng: lang }));
          return;
        }

        const now = new Date();
        const scheduledDate = new Date();
        scheduledDate.setHours(h, m, 0, 0);
        if (scheduledDate <= now) scheduledDate.setDate(scheduledDate.getDate() + 1);

        const mediaType = state.mediaType || "video";
        const article = await ScraperService.scrapeArticle(state.url).catch(() => null);
        const esc = (value: string) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const caption = article?.title ? `<b>${esc(article.title)}</b>\n\n${esc((article.content || "").slice(0, 400))}` : i18n.t("scheduled_post", { lng: lang });

        await DBService.addScheduledPost(chatId, mediaType as any, { url: state.url, caption }, scheduledDate.toISOString());
        userStates.delete(chatId);
        await bot.sendMessage(chatId, `${i18n.t("bot_schedule_saved", { lng: lang })}\n${scheduledDate.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`);
        return;
      }

      userStates.delete(chatId);
      await bot.sendMessage(chatId, i18n.t("bot_schedule_bad_format", { lng: lang }));
      return;
    }

    if (state?.type === "admin_broadcast") {
      if (user?.role !== "owner" && user?.role !== "admin") {
        userStates.delete(chatId);
        return;
      }
      const users = await DBService.getAllUsers();
      let count = 0;
      await bot.sendMessage(chatId, i18n.t("users_in_queue", { lng: lang }).replace("{count}", String(users.length)));
      for (const targetUser of users) {
        try {
          await bot.sendMessage(targetUser.telegram_id, text, { parse_mode: "HTML" });
          count++;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (e: any) {
          logger.warn(`Broadcast failed for ${targetUser.telegram_id}: ${e.message}`);
        }
      }
      await bot.sendMessage(chatId, i18n.t("broadcast_complete", { lng: lang }).replace("{count}", String(count)));
      userStates.delete(chatId);
      return;
    }

    if (/youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/i.test(text)) {
      const mediaUrl = extractUrlFromText(text);
      if (mediaUrl) {
        userStates.set(chatId, { type: "media_download", url: mediaUrl, createdAt: Date.now() });
      }

      const isPlaylist = text.includes("playlist") || text.includes("list=") || text.includes("/sets/");
      const inlineKeyboard: TelegramBot.InlineKeyboardButton[][] = [];
      if (isPlaylist) {
        inlineKeyboard.push([{ text: i18n.t("media_bulk_download", { lng: lang }), callback_data: "dl_playlist_all" }]);
      }
      inlineKeyboard.push([
        { text: i18n.t("media_video_chat", { lng: lang }), callback_data: "dl_media_video_chat" },
        { text: i18n.t("media_audio_chat", { lng: lang }), callback_data: "dl_media_audio_chat" },
      ]);
      inlineKeyboard.push([
        { text: i18n.t("media_video_channel", { lng: lang }), callback_data: "dl_media_video_channel" },
        { text: i18n.t("media_audio_channel", { lng: lang }), callback_data: "dl_media_audio_channel" },
      ]);
      inlineKeyboard.push([{ text: i18n.t("media_schedule", { lng: lang }), callback_data: "schedule_media" }]);
      inlineKeyboard.push([{ text: i18n.t("cancel", { lng: lang }), callback_data: "cancel_dl" }]);

      await bot.sendMessage(chatId, `${i18n.t("media_detected", { lng: lang })}\n\n${i18n.t("download_ask", { lng: lang })}`, {
        reply_markup: { inline_keyboard: inlineKeyboard },
        reply_to_message_id: msg.message_id,
      });
    }
  });

  for (const cmd of commands) {
    bot.onText(cmd.pattern, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
      try {
        logger.info(`Pattern Match: ${cmd.pattern} by ${msg.from?.id}`);
        await cmd.handler(bot, msg, match);
      } catch (error: any) {
        logger.error(`Error handling ${cmd.pattern}: ${error.message}`);
      }
    });
  }

  bot.on("pre_checkout_query", async (query) => {
    try {
      const payload = query.invoice_payload;
      if (!payload || !payload.startsWith("premium_sub_")) {
        await bot.answerPreCheckoutQuery(query.id, false, { error_message: i18n.t("payment_invalid_payload", { lng: "en" }) });
        return;
      }
      await bot.answerPreCheckoutQuery(query.id, true);
    } catch (e: any) {
      logger.error(`pre_checkout_query error: ${e.message}`);
      try {
        await bot.answerPreCheckoutQuery(query.id, false, { error_message: i18n.t("server_error", { lng: "en" }) });
      } catch (inner: any) {
        logger.warn(`PreCheckoutQuery answer failed: ${inner.message}`);
      }
    }
  });

  bot.on("successful_payment", async (msg) => {
    const chatId = msg.chat.id;
    const payment = msg.successful_payment;
    if (!payment) return;

    try {
      const payload = payment.invoice_payload;
      if (payload?.startsWith("premium_sub_")) {
        const withoutPrefix = payload.replace("premium_sub_", "");
        const isYearly = withoutPrefix.endsWith("_yearly");
        const userIdStr = isYearly ? withoutPrefix.replace("_yearly", "") : withoutPrefix;
        let userId = parseInt(userIdStr, 10);
        if (Number.isNaN(userId) || userId <= 0) userId = chatId;

        const days = isYearly ? 365 : 30;
        await DBService.setPremium(userId, days);
        const paidUser = await DBService.getUser(chatId);
        await bot.sendMessage(chatId, i18n.t("bot_premium_activated", { lng: paidUser?.language || "uz" }));
      }
    } catch (e: any) {
      logger.error(`successful_payment error: ${e.message}`);
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId || !query.data) return;
    if (!await checkRateLimit(query.from?.id ?? chatId ?? 0)) {
      logger.warn(`Rate limited callback`);
      await bot.answerCallbackQuery(query.id, { text: i18n.t("too_many_requests", { lng: "en" }) }).catch(() => {});
      return;
    }
    await handleCallbackQuery(bot, query, userStates);
  });
}
