import TelegramBot from "node-telegram-bot-api";
import { helpCommand } from "./help";
import { adminCommand } from "./admin";
import { setChannelCommand } from "./setchannel";
import { statusCommand } from "./status";
import { trackCommand } from "./track";
import { sendNextOnboardingStep, startCommand } from "./start";
import { langCommand } from "./lang";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { logger } from "../utils/logger";
import { i18n, WEBAPP_LANGS } from "../services/i18n";
import { CONFIG } from "../config/config";
import { ScraperService } from "../services/scraper";
import { generateDashboardToken } from "../services/bot_instance";
import { PaymentService } from "../services/payment";

export const commands: BotCommand[] = [
  startCommand,
  statusCommand,
  trackCommand,
  adminCommand,
  setChannelCommand,
  helpCommand,
  langCommand,
];

interface UserStateEntry {
  type: string;
  url: string;
  mediaType?: string;
  sendTarget?: "chat" | "channel";
  createdAt: number;
}

function extractUrlFromText(text: string): string | null {
  const match = text.match(/(https?:\/\/[^\s]+)/);
  return match ? match[0] : null;
}

function isLikelyRssUrl(url: string): boolean {
  return /rss|feed|xml|atom/i.test(url);
}

function buildDashboardUrl(chatId: number): string | null {
  if (!CONFIG.PUBLIC_URL) return null;
  return `${CONFIG.PUBLIC_URL}/dashboard?token=${generateDashboardToken(chatId)}&user=${chatId}&v=${Date.now()}`;
}

function resolveMediaUrl(query: TelegramBot.CallbackQuery, userStates: Map<number, UserStateEntry>, chatId: number): string | null {
  const pending = userStates.get(chatId);
  if (pending?.url && (pending.type === "media_download" || pending.type === "schedule_time")) {
    return pending.url;
  }

  const msg = query.message as any;
  const replyText = msg?.reply_to_message?.text || "";
  const fromReply = extractUrlFromText(replyText);
  if (fromReply) return fromReply;

  const fromMessage = extractUrlFromText(msg?.text || "");
  if (fromMessage) return fromMessage;

  const entities = msg?.reply_to_message?.entities || [];
  const urlEntity = entities.find((e: any) => e.type === "url" || e.type === "text_link");
  if (!urlEntity) return null;

  if (urlEntity.type === "url") {
    return replyText.substring(urlEntity.offset, urlEntity.offset + urlEntity.length);
  }
  return urlEntity.url;
}

let cachedBotInfo: TelegramBot.User | null = null;

export function registerCommands(bot: TelegramBot) {
  const userStates = new Map<number, UserStateEntry>();

  const getBotInfo = async () => {
    if (!cachedBotInfo) cachedBotInfo = await bot.getMe();
    return cachedBotInfo;
  };

  setInterval(() => {
    const now = Date.now();
    for (const [id, state] of userStates.entries()) {
      if (now - state.createdAt > 30 * 60 * 1000) userStates.delete(id);
    }
  }, 5 * 60 * 1000);

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    logger.info(`Incoming from ${chatId} (len=${text.length})`);
    if (text.startsWith("/")) return;

    const user = await DBService.getUser(chatId);
    const lang = user?.language || "uz";
    const state = userStates.get(chatId);

    // Onboarding: Language step fallback
    if (user && !user.has_seen_lang) {
      const { sendLanguageStep } = await import("./start");
      await sendLanguageStep(bot, chatId);
      return;
    }

    // Onboarding: Channel connection step
    if (user && !user.target_channel) {
      let targetText = text.trim();
      if (targetText.includes("t.me/")) {
        const parts = targetText.split("t.me/");
        const handle = parts[parts.length - 1].split("/")[0].trim();
        if (handle) targetText = `@${handle}`;
      }
      if (!targetText.startsWith("@") && !targetText.startsWith("-100") && /^[a-zA-Z0-9_]{5,32}$/.test(targetText)) {
        targetText = `@${targetText}`;
      }

      if (targetText.startsWith("@") || targetText.startsWith("-100")) {
        try {
          const channelChat = await bot.getChat(targetText);
          const botInfo = await getBotInfo();
          const member = await bot.getChatMember(channelChat.id, botInfo.id);
          if (member.status !== "administrator" && member.status !== "creator") {
            await bot.sendMessage(chatId, i18n.t("bot_channel_not_admin", { lng: lang }));
            return;
          }

          const saved = await DBService.updateUser(chatId, { target_channel: targetText });
          if (!saved) {
            await bot.sendMessage(chatId, i18n.t("bot_channel_save_failed", { lng: lang }));
            return;
          }

          await DBService.checkAndMarkReferralActive(chatId);
          await bot.sendMessage(chatId, i18n.t("onboarding_success", { lng: lang }));
          await sendNextOnboardingStep(bot, chatId);
          return;
        } catch {
          await bot.sendMessage(chatId, i18n.t("err_invalid_channel", { lng: lang }));
          return;
        }
      } else {
        await bot.sendMessage(chatId, i18n.t("bot_send_channel_example", { lng: lang }));
        return;
      }
    }

    // Onboarding: RSS feed source URL connection step
    const sources = user?.target_channel ? await DBService.getUserSources(chatId) : [];
    if (user?.target_channel && sources.length === 0) {
      const trimmed = text.trim();
      let websiteInput = extractUrlFromText(trimmed);
      if (!websiteInput) {
        const compact = trimmed.replace(/\s+/g, "");
        if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(compact)) {
          websiteInput = `https://${compact}`;
        } else if (/^[a-zA-Z0-9-]{2,}$/.test(compact)) {
          websiteInput = `https://${compact}.uz`;
        }
      }

      if (!websiteInput) {
        await bot.sendMessage(chatId, `${i18n.t("onboarding_rss_body", { lng: lang })}\n\nWebsite yuboring (masalan: <code>kun.uz</code>) — bot RSS ni o'zi topadi.`, { parse_mode: "HTML" });
        return;
      }

      if (!/^https?:\/\//i.test(websiteInput)) websiteInput = `https://${websiteInput}`;
      const safeWebsite = websiteInput;
      if (!(await ScraperService.isPublicExternalUrl(safeWebsite))) {
        await bot.sendMessage(chatId, i18n.t("err_invalid_url", { lng: lang }));
        return;
      }

      let rssUrl: string | null = null;
      if (isLikelyRssUrl(safeWebsite)) {
        rssUrl = safeWebsite;
      } else {
        rssUrl = await ScraperService.discoverRSS(safeWebsite);
      }

      if (!rssUrl) {
        await bot.sendMessage(chatId, "Bu sayt uchun RSS topilmadi. Saytning to'liq URL manzilini yuboring (masalan: https://example.com).");
        return;
      }

      const ok = await DBService.addSource(chatId, "Primary RSS", rssUrl, lang);
      if (!ok) {
        await bot.sendMessage(chatId, i18n.t("err_invalid_url", { lng: lang }));
        return;
      }
      await bot.sendMessage(chatId, `${i18n.t("quick_source_saved", { lng: lang })}\n\nRSS: ${rssUrl}`);
      await sendNextOnboardingStep(bot, chatId);
      return;
    }

    // Onboarding: Posting interval cadence step
    if (user?.target_channel && sources.length > 0 && (!user.interval_minutes || Number(user.interval_minutes) < 1)) {
      const minutes = Number(text.trim());
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        await bot.sendMessage(chatId, i18n.t("quick_invalid_interval", { lng: lang }));
        return;
      }
      await DBService.updateUser(chatId, { interval_minutes: minutes });
      await bot.sendMessage(chatId, i18n.t("quick_interval_saved", { lng: lang }));
      await sendNextOnboardingStep(bot, chatId);
      return;
    }

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
        const caption = article?.title ? `<b>${esc(article.title)}</b>\n\n${esc((article.content || "").slice(0, 400))}` : "Scheduled Post";

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
      await bot.sendMessage(chatId, `${users.length} users in queue...`);
      for (const targetUser of users) {
        try {
          await bot.sendMessage(targetUser.telegram_id, text, { parse_mode: "HTML" });
          count++;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (e: any) {
          logger.warn(`Broadcast failed for ${targetUser.telegram_id}: ${e.message}`);
        }
      }
      await bot.sendMessage(chatId, `Broadcast complete: ${count}`);
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
        inlineKeyboard.push([{ text: "Bulk Download", callback_data: "dl_playlist_all" }]);
      }
      inlineKeyboard.push([
        { text: "Video (Chat)", callback_data: "dl_media_video_chat" },
        { text: "Audio (Chat)", callback_data: "dl_media_audio_chat" },
      ]);
      inlineKeyboard.push([
        { text: "Video (Channel)", callback_data: "dl_media_video_channel" },
        { text: "Audio (Channel)", callback_data: "dl_media_audio_channel" },
      ]);
      inlineKeyboard.push([{ text: "Schedule", callback_data: "schedule_media" }]);
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
        await bot.answerPreCheckoutQuery(query.id, false, { error_message: "Invalid payment payload" });
        return;
      }
      await bot.answerPreCheckoutQuery(query.id, true);
    } catch (e: any) {
      logger.error(`pre_checkout_query error: ${e.message}`);
      try {
        await bot.answerPreCheckoutQuery(query.id, false, { error_message: "Server error" });
      } catch {}
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
        } catch (e: any) {
          logger.warn(`setMyCommands error on setlang: ${e.message}`);
        }

        await bot.answerCallbackQuery(query.id, { text: "OK" });
        await bot.sendMessage(chatId, i18n.t("bot_lang_saved", { lng: langCode }));
        await sendNextOnboardingStep(bot, chatId, { ...user, language: langCode, has_seen_lang: true });
        return;
      }

      if (data.startsWith("dl_media_")) {
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
          await bot.editMessageText(`Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
        }
        return;
      }

      if (data === "dl_playlist_all") {
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
          links.forEach((link, index) => {
            text += `${index + 1}. ${link.title}\n${link.url}\n\n`;
          });
          await bot.editMessageText(text, { chat_id: chatId, message_id: waitMsg.message_id, disable_web_page_preview: true });
        } catch (err: any) {
          await bot.editMessageText(`Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
        }
        return;
      }

      if (data === "schedule_media") {
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
        if (dashUrl) {
          inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
        }
        inlineKeyboard.push([{ text: "🌐 Language / Tilni o'zgartirish", callback_data: "cmd_lang" }]);
        await bot.sendMessage(chatId, i18n.t("bot_settings_panel", { lng: lang }), {
          reply_markup: { inline_keyboard: inlineKeyboard },
        });
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
        await bot.sendMessage(
          chatId,
          `${i18n.t("bot_stats_title", { lng: lang })}\n\nPosts: ${stats.total_posts || 0}\nDuplicates: ${stats.total_duplicates || 0}`
        );
        return;
      }

      if (data === "cmd_referral") {
        const code = await DBService.ensureReferralCode(chatId);
        const refStats = await DBService.getReferralStats(chatId);
        const botMe = await getBotInfo();
        const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
        await bot.sendMessage(chatId, `${i18n.t("bot_referral_title", { lng: lang })}\n\n${refLink}\n\nTotal: ${refStats.total}\nActive: ${refStats.active}\nLeft for premium: ${refStats.needed}`);
        return;
      }

      if (data === "buy_premium") {
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
        if (dashUrl) {
          inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
        }

        await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
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
        if (dashUrl) {
          inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashUrl } }]);
        }
        await bot.sendMessage(chatId, i18n.t("bot_open_dashboard", { lng: lang }), {
          reply_markup: { inline_keyboard: inlineKeyboard },
        });
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
  });
}
