import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { registerCommands } from "../commands";
import { safeSend } from "./sender";

/**
 * startBot — passive setup only (no webhook, no polling).
 * Grammy bot handles all Telegram communication via webhook.
 * This function only registers legacy handlers for backward compat.
 */
export async function startBot() {
  logger.info('Bot passive instance registering handlers...');

  const { TelegramMonitorService } = await import("./telegram_monitor");
  bot.on("channel_post", async (msg) => {
    try {
      await TelegramMonitorService.handleChannelPost(msg);
    } catch (e: unknown) {
      logger.error(`channel_post handler: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  if (CONFIG.OWNER_ID != null) {
    try {
      await notify(CONFIG.OWNER_ID, `<b>mateAssistent Bot v2.0.0</b> is live!`);
    } catch (e: unknown) {
      logger.warn(`Owner notify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export { bot, notify };
export { safeSend };
