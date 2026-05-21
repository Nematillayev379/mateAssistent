import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { registerCommands } from "../commands";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import crypto from "crypto";

const instanceId = crypto.randomUUID();
let cachedBotUser: string | null = null;
let lastBotUserFetch = 0;
const sendFailureAlertCooldowns = new Map<string, number>();

const MAX_RESTART_ATTEMPTS = 10;
let pollingRestartAttempts = 0;
let pollingRestartTimer: NodeJS.Timeout | null = null;
let pollingErrorHandlerAttached = false;

export async function startBot() {
  logger.info(`Bot instance starting (ID: ${instanceId})`);
  registerCommands(bot);

  const { TelegramMonitorService } = await import("./telegram_monitor");
  bot.on("channel_post", async (msg) => {
    try {
      await TelegramMonitorService.handleChannelPost(msg);
    } catch (e: any) {
      logger.error(`channel_post handler: ${e.message}`);
    }
  });

  try {
    await bot.setMyCommands([
      { command: "start", description: "Boshlash / Main Menu" },
      { command: "status", description: "Statistika / Stats" },
      { command: "setchannel", description: "Kanalni sozlash / Change channel" },
      { command: "track", description: "Narx kuzatish / Price tracking" },
      { command: "help", description: "Yordam / Help Guide" },
    ]);
  } catch (e: any) {
    logger.warn(`setMyCommands error: ${e.message}`);
  }

  if (CONFIG.PUBLIC_URL && process.env.NODE_ENV !== "development") {
    try {
      const webhookUrl = `${CONFIG.PUBLIC_URL}/api/bot/webhook`;
      await bot.setWebHook(webhookUrl, {
        secret_token: CONFIG.WEBHOOK_SECRET,
        max_connections: 100,
      });
      logger.info(`Webhook set to: ${webhookUrl} (max_connections=100)`);
    } catch (err: any) {
      logger.error(`setWebHook error: ${err.message}`);
      await bot.deleteWebHook().catch(() => {});
      initPolling();
      logger.info("Polling started (webhook failed, fallback)");
    }
  } else {
    await bot.deleteWebHook().catch(() => {});
    initPolling();
    logger.info("Polling started (no PUBLIC_URL)");
  }

  if (CONFIG.OWNER_ID != null) {
    try {
      await notify(CONFIG.OWNER_ID, `<b>mateAssistent Bot v11.0</b> is live!`);
    } catch {}
  }
}

function initPolling() {
  startPollingSafe();

  if (!pollingErrorHandlerAttached) {
    bot.on("polling_error", (error: any) => {
      handlePollingError(error);
    });
    pollingErrorHandlerAttached = true;
  }
}

function getPollingErrorMessage(error: any): string {
  return String(error?.message || error || "Unknown polling error");
}

function isFatalPollingError(message: string): boolean {
  return /409 Conflict|401 Unauthorized|404 Not Found|connect EACCES/i.test(message);
}

function getPollingRestartDelay(attempt: number): number {
  return Math.min(5000 * Math.max(attempt, 1), 30000);
}

function clearPollingRestartTimer() {
  if (pollingRestartTimer) {
    clearTimeout(pollingRestartTimer);
    pollingRestartTimer = null;
  }
}

function startPollingSafe() {
  clearPollingRestartTimer();

  try {
    const maybePromise = bot.startPolling();
    Promise.resolve(maybePromise)
      .then(() => {
        pollingRestartAttempts = 0;
      })
      .catch((error: any) => {
        logger.error(`startPolling error: ${getPollingErrorMessage(error)}`);
      });
  } catch (error: any) {
    logger.error(`startPolling throw: ${getPollingErrorMessage(error)}`);
  }
}

function handlePollingError(error: any) {
  const message = getPollingErrorMessage(error);
  logger.error(`Polling error: ${message}`);

  if (message.includes("409 Conflict")) {
    logger.warn("Polling conflict detected. Stopping polling.");
    clearPollingRestartTimer();
    bot.stopPolling();
    return;
  }

  pollingRestartAttempts++;

  if (isFatalPollingError(message)) {
    logger.error(`Fatal polling error detected. Stopping polling after ${pollingRestartAttempts} attempt(s).`);
    clearPollingRestartTimer();
    bot.stopPolling();
    return;
  }

  if (pollingRestartAttempts > MAX_RESTART_ATTEMPTS) {
    logger.error(`Too many polling errors (${pollingRestartAttempts}). Stopping polling.`);
    clearPollingRestartTimer();
    bot.stopPolling();
    return;
  }

  if (pollingRestartTimer) return;

  const restartDelay = getPollingRestartDelay(pollingRestartAttempts);
  pollingRestartTimer = setTimeout(() => {
    pollingRestartTimer = null;
    if (!bot.isPolling()) {
      startPollingSafe();
    }
  }, restartDelay);
}

export async function safeSendToChannels(
  _user: any,
  channels: string[],
  sendFn: (normalizedChannel: string) => Promise<void>
): Promise<number> {
  const results = await Promise.allSettled(
    channels.map(async (ch) => {
      const normalized = normalizeChannelId(ch);
      if (!normalized) throw new Error("Empty target channel");
      await sendFn(normalized);
    })
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn(`Multi-channel send failed ${channels[index]}: ${result.reason?.message || result.reason}`);
    }
  });

  return results.filter((result) => result.status === "fulfilled").length;
}

function normalizeChannelId(channel: string): string {
  let targetChannel = String(channel).trim();
  if (!targetChannel) return "";
  if (/^\d+$/.test(targetChannel)) targetChannel = `-100${targetChannel}`;
  else if (!targetChannel.startsWith("@") && !targetChannel.startsWith("-")) targetChannel = `@${targetChannel}`;
  return targetChannel;
}

export async function safeSend(user: any, article: any): Promise<void> {
  if (!article) {
    logger.warn("safeSend skipped: article is missing");
    return;
  }

  if (!cachedBotUser || Date.now() - lastBotUserFetch > 3600000) {
    try {
      const me = await bot.getMe();
      cachedBotUser = me.username || "bot";
      lastBotUserFetch = Date.now();
    } catch {
      cachedBotUser = cachedBotUser || "bot";
    }
  }

  const botUser = cachedBotUser;
  const safeTitle = escapeHtml(article.title || "");
  const safeContent = escapeHtml(article.content || "");
  const safeSource = escapeHtml(article.source || "yangiliklar");
  const safeUrl = escapeUrl(article.url || "");
  const sourceLine = `🌐 <a href="${safeUrl}">${safeSource}</a>`;
  const botLine = `🤖 <a href="https://t.me/${botUser}">@${botUser}</a>`;
  const footer = `\n\n${sourceLine}\n${botLine}`;
  const titleBlock = `<b>${safeTitle}</b>`;

  const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
  const maxLen = isMediaMessage ? 1024 : 4096;
  const headerLen = titleBlock.length + 2;
  const footerLen = footer.length + 4;
  const availableForContent = maxLen - headerLen - footerLen;

  let finalContent = safeContent;
  if (finalContent.length > availableForContent) {
    finalContent = finalContent.slice(0, Math.max(0, availableForContent - 3)) + "...";
  }

  const caption = `${titleBlock}\n\n${finalContent}${footer}`;

  try {
    if (!user.target_channel) {
      logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
      return;
    }

    const targets = DBService.getUserOutputChannels(user);
    const sent = await safeSendToChannels(user, targets.length ? targets : [user.target_channel], async (targetChannel) => {
      if (article.videoUrl && ScraperService.isMediaUrl(article.videoUrl)) {
        await bot.sendVideo(targetChannel, article.videoUrl, { caption, parse_mode: "HTML" });
      } else if (article.audioUrl && ScraperService.isMediaUrl(article.audioUrl)) {
        await bot.sendAudio(targetChannel, article.audioUrl, { caption, parse_mode: "HTML" });
      } else if (article.imageUrl) {
        await bot.sendPhoto(targetChannel, article.imageUrl, { caption, parse_mode: "HTML" });
      } else {
        await bot.sendMessage(targetChannel, caption, { parse_mode: "HTML" });
      }
    });

    if (sent === 0) throw new Error("All target channel sends failed");
    await DBService.incrementStat(user.telegram_id, "total_posts");
  } catch (e: any) {
    logger.error(`safeSend error: ${e.message}`);
    try {
      const cooldownKey = `${user.telegram_id}:${normalizeChannelId(user.target_channel || "")}`;
      const now = Date.now();
      if (now >= (sendFailureAlertCooldowns.get(cooldownKey) || 0)) {
        sendFailureAlertCooldowns.set(cooldownKey, now + 30 * 60 * 1000);
        await bot.sendMessage(
          user.telegram_id,
          `⚠️ <b>Xatolik!</b>\n\nKanalingizga xabar yuborib bo'lmadi. Iltimos, botni kanalga admin qilganingizni va kanal manzili to'g'riligini tekshiring.\n\nXato: <code>${escapeHtml(e.message)}</code>`,
          { parse_mode: "HTML" }
        );
      }
    } catch {}
    throw e;
  }
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeUrl(text: string): string {
  return String(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

export const __testing = {
  getPollingRestartDelay,
  isFatalPollingError,
  handlePollingError,
  resetPollingState() {
    pollingRestartAttempts = 0;
    clearPollingRestartTimer();
    pollingErrorHandlerAttached = false;
  },
};

export { bot, notify };
