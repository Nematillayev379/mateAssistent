import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { registerCommands } from "../commands";
import crypto from "crypto";

const instanceId = crypto.randomUUID();
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
      const whInfo = await bot.getWebHookInfo();
      if (whInfo.url === webhookUrl) {
        logger.info(`Webhook set to: ${webhookUrl} (max_connections=100)`);
      } else {
        throw new Error(`Webhook not confirmed (got: ${whInfo.url})`);
      }
    } catch (err: any) {
      logger.error(`setWebHook error: ${err.message}`);
      if (err.message.includes('409') || err.message.includes('Conflict')) {
        logger.warn('Webhook conflict — not falling back to polling');
      } else {
        await bot.deleteWebHook().catch(() => {});
        initPolling();
        logger.info("Polling started (webhook failed, fallback)");
      }
    }
  } else {
    await bot.deleteWebHook().catch((delErr: any) => logger.warn(`Webhook delete error: ${delErr.message}`));
    initPolling();
    logger.info("Polling started (no PUBLIC_URL)");
  }

  if (CONFIG.OWNER_ID != null) {
    try {
      await notify(CONFIG.OWNER_ID, `<b>mateAssistent Bot v11.0</b> is live!`);
    } catch (e: any) {
      logger.warn(`Owner notify failed: ${e.message}`);
    }
  }
}

function initPolling() {
  startPollingSafe();
  if (!pollingErrorHandlerAttached) {
    bot.on("polling_error", (error: any) => { handlePollingError(error); });
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
      .then(() => { pollingRestartAttempts = 0; })
      .catch((error: any) => { logger.error(`startPolling error: ${getPollingErrorMessage(error)}`); });
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
    if (!bot.isPolling()) startPollingSafe();
  }, restartDelay);
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
