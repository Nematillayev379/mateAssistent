import TelegramBot from "node-telegram-bot-api";
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";

// Initialize bot with optimized network settings for Render/Linux
export const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { 
  polling: false,
  filepath: false, // Optimizes memory
});

/**
 * Shared notify helper to send messages safely
 */
export async function notify(chatId: number | string, text: string, options: TelegramBot.SendMessageOptions = {}) {
  try {
    return await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...options });
  } catch (e: any) {
    logger.warn(`Message notify error to ${chatId}: ${e.message}`);
  }
}
