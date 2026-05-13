import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { registerCommands } from "../commands";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import { i18n } from "./i18n";
import crypto from "crypto";

const instanceId = crypto.randomUUID();

const userStates = new Map<number, { type: string, url: string }>();
let cachedBotUser: string | null = null;

export async function startBot() {
  logger.info(`🤖 Bot instance starting (ID: ${instanceId})`);

  // Register commands
  registerCommands(bot);

  // Setup Bot Commands Menu
  try {
    await bot.setMyCommands([
      { command: 'start', description: '🏠 Boshlash' },
      { command: 'status', description: '📊 Statistika' },
      { command: 'track',  description: '🔔 Narx kuzatish' },
      { command: 'help',  description: '📚 Yordam' },
    ]);
  } catch (e: any) {
    logger.warn(`⚠️ setMyCommands error: ${e.message}`);
  }

  // --- WEBHOOK SETUP FOR RENDER ---
  if (CONFIG.PUBLIC_URL) {
    try {
      const webhookUrl = `${CONFIG.PUBLIC_URL}/api/bot/webhook`;
      await bot.setWebHook(webhookUrl);
      logger.info(`🌐 Webhook set to: ${webhookUrl}`);
    } catch (err: any) {
      logger.error(`❌ setWebHook error: ${err.message}`);
    }
  } else {
    // Fallback to polling if no public URL (Bug #31: Better polling options)
    await bot.deleteWebHook().catch(() => {});
    bot.startPolling();
    logger.info(`🚀 Polling started (Optimized for speed)`);
  }

  // Startup notification
  if (CONFIG.OWNER_ID) {
    try {
      await notify(CONFIG.OWNER_ID, `🚀 <b>Newsroom Bot v11.0</b> is live via Webhook!`);
    } catch {}
  }
}

/** 
 * Safe send with media support
 * This will be called by AI Workers
 */
export async function safeSend(user: any, article: any): Promise<void> {
  const lang = user.language || 'uz';
  
  // BUG #60 Fix: Cache botMe to avoid repeated API calls
  if (!cachedBotUser) {
    try {
      const me = await bot.getMe();
      cachedBotUser = me.username || 'bot';
    } catch {
      cachedBotUser = 'bot';
    }
  }
  
  const botUser = cachedBotUser;
  const viralFooter = `\n\n🤖 <a href="https://t.me/${botUser}">@${botUser}</a> ${i18n.t('viral_tag', { lng: lang }) || 'bilan yaratildi. Siz ham qo\'shing!'}`;
  const caption = `${article.emoji || '🗞'} <b>${article.title}</b>\n\n${article.content}${viralFooter}\n\n🔗 <a href="${article.url}">${article.source}</a>`;

  try {
    if (!user.target_channel) {
      logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
      return;
    }

    if (article.videoUrl && (await ScraperService.isValidMedia(article.videoUrl))) {
      await bot.sendVideo(user.target_channel, article.videoUrl, { caption, parse_mode: "HTML" });
    } else if (article.audioUrl) {
      await bot.sendAudio(user.target_channel, article.audioUrl, { caption, parse_mode: "HTML" });
    } else if (article.imageUrl && (await ScraperService.isValidMedia(article.imageUrl))) {
      await bot.sendPhoto(user.target_channel, article.imageUrl, { caption, parse_mode: "HTML" });
    } else {
      // Fallback text only if no media
      await bot.sendMessage(user.target_channel, caption, { parse_mode: "HTML" });
    }
    
    await DBService.incrementStat(user.telegram_id, 'total_posts');
  } catch (e: any) {
    logger.error(`❌ safeSend Error: ${e.message}`);
    // BUG #74 Fix: Notify user if message delivery fails (e.g. bot kicked from channel)
    try {
      await bot.sendMessage(user.telegram_id, `⚠️ <b>Xatolik!</b>\n\nKanalingizga xabar yuborib bo'lmadi. Iltimos, botni kanalga admin qilganingizni va kanal manzili to'g'riligini tekshiring.\n\nXato: <code>${e.message}</code>`, { parse_mode: 'HTML' });
    } catch {}
  }
}

export { bot, notify };
