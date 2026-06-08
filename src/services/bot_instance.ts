import { botCompat } from "./grammy-wrapper";
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import crypto from "crypto";

export const bot = botCompat;

const dashboardTokenSecret = CONFIG.DASHBOARD_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
if (!CONFIG.DASHBOARD_SECRET?.trim()) {
  logger.warn('DASHBOARD_SECRET is missing; using an ephemeral secret for per-user dashboard tokens.');
}

export function generateDashboardToken(userId: number | string): string {
  return crypto.createHash('sha256').update(`${userId}:${dashboardTokenSecret}`).digest('hex').slice(0, 32);
}

export function buildDashboardUrl(userId: number | string): string | null {
  const base = String(CONFIG.PUBLIC_URL || "").trim();
  if (!/^https?:\/\//i.test(base)) {
    return null;
  }
  return `${base}/dashboard/overview.html?token=${generateDashboardToken(userId)}&user=${userId}&v=${Date.now()}`;
}

export async function notify(chatId: number | string, text: string, options: any = {}) {
  try {
    return await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...options });
  } catch (e: unknown) {
    logger.warn(`Message notify error to ${chatId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
