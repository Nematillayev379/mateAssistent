import TelegramBot from "node-telegram-bot-api";
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import crypto from "crypto";

// Initialize bot with optimized network settings for Render/Linux
export const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { 
  polling: false,
  filepath: false, // Optimizes memory
});

/**
 * Bug #27 Fix: Generates a unique token for each user to prevent IDOR
 */
export function generateDashboardToken(userId: number | string): string {
  const secret = CONFIG.DASHBOARD_SECRET || 'fallback-secret';
  return crypto.createHash('sha256').update(`${userId}:${secret}`).digest('hex').slice(0, 32);
}

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
