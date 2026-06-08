import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { safeSend } from "./sender";

/**
 * startBot — passive setup only (no webhook, no polling).
 * Grammy bot handles all Telegram communication via webhook.
 */
export async function startBot() {
  logger.info('Bot passive instance starting...');

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
