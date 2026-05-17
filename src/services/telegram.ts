import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { registerCommands } from "../commands";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import crypto from "crypto";

const instanceId = crypto.randomUUID();

// BUG-066 Fix: Removed unused userStates Map (it's only in commands/index.ts now)
let cachedBotUser: string | null = null;
let lastBotUserFetch = 0;

// B-19 Fix: Add polling error handler with restart attempts
const MAX_RESTART_ATTEMPTS = 10;
let pollingRestartAttempts = 0;

export async function startBot() {
  logger.info(`🤖 Bot instance starting (ID: ${instanceId})`);

  // Register commands
  registerCommands(bot);

  // Telegram → Telegram channel monitoring (bot must be admin in source channels)
  const { TelegramMonitorService } = await import('./telegram_monitor');
  bot.on('channel_post', async (msg) => {
    try {
      await TelegramMonitorService.handleChannelPost(msg);
    } catch (e: any) {
      logger.error(`channel_post handler: ${e.message}`);
    }
  });

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
  // BUG-067 Fix: Exclusively use webhook OR polling, not both
  if (CONFIG.PUBLIC_URL) {
    try {
      const webhookUrl = `${CONFIG.PUBLIC_URL}/api/bot/webhook`;
      await bot.setWebHook(webhookUrl);
      logger.info(`🌐 Webhook set to: ${webhookUrl}`);
    } catch (err: any) {
      logger.error(`❌ setWebHook error: ${err.message}`);
      // Fallback to polling only if webhook fails
      await bot.deleteWebHook().catch(() => {});
      initPolling();
      logger.info(`🚀 Polling started (webhook failed, fallback)`);
    }
  } else {
    // No public URL — use polling
    await bot.deleteWebHook().catch(() => {});
    initPolling();
    logger.info(`🚀 Polling started (no PUBLIC_URL)`);
  }

  // Startup notification
  if (CONFIG.OWNER_ID) {
    try {
      await notify(CONFIG.OWNER_ID, `🚀 <b>Newsroom Bot v11.0</b> is live!`);
    } catch {}
  }
}

function initPolling() {
  bot.startPolling();
  
  // B-19 Fix: Add polling error handler with restart attempts
  bot.on('polling_error', (error: any) => {
    logger.error(`❌ Polling error: ${error.message}`);
    
    if (error.message.includes('409 Conflict')) {
      logger.warn('⚠️ Polling conflict (another instance?). Stopping polling to avoid spam.');
      bot.stopPolling();
      return;
    }

    pollingRestartAttempts++;
    if (pollingRestartAttempts > MAX_RESTART_ATTEMPTS) {
      logger.error(`🔥 Too many polling errors (${pollingRestartAttempts}). Giving up to prevent infinite loop.`);
      bot.stopPolling();
      return;
    }

    logger.info(`🔄 Attempting to recover polling (${pollingRestartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
    // Wait before continuing
    setTimeout(() => {
      if (!bot.isPolling()) {
        bot.startPolling();
      }
    }, 5000);
  });
}

/** 
 * Safe send with media support
 * BUG-069 Fix: Truncate caption to Telegram limits
 * BUG-070 Fix: Validate audio URL
 * BUG-071 Fix: Handle target_channel format
 */
/** Publish to primary + extra output channels */
export async function safeSendToChannels(
  user: any,
  channels: string[],
  sendFn: (normalizedChannel: string) => Promise<void>
): Promise<void> {
  for (const ch of channels) {
    const normalized = normalizeChannelId(ch);
    if (!normalized) continue;
    try {
      await sendFn(normalized);
    } catch (e: any) {
      logger.warn(`Multi-channel send failed ${normalized}: ${e.message}`);
    }
  }
}

function normalizeChannelId(channel: string): string {
  let targetChannel = String(channel).trim();
  if (!targetChannel) return '';
  if (/^\d+$/.test(targetChannel)) targetChannel = `-100${targetChannel}`;
  else if (!targetChannel.startsWith('@') && !targetChannel.startsWith('-')) targetChannel = `@${targetChannel}`;
  return targetChannel;
}

export async function safeSend(user: any, article: any): Promise<void> {
  if (!article) {
    logger.warn('safeSend skipped: article is missing');
    return;
  }
  // BUG-018 & BUG-068 Fix: Refresh bot username periodically (every hour)
  if (!cachedBotUser || Date.now() - lastBotUserFetch > 3600000) {
    try {
      const me = await bot.getMe();
      cachedBotUser = me.username || 'bot';
      lastBotUserFetch = Date.now();
    } catch {
      cachedBotUser = cachedBotUser || 'bot';
    }
  }
  
  const botUser = cachedBotUser;
  const botAd = `🤖 <a href="https://t.me/${botUser}">@${escapeHtml(botUser)}</a>`;
  
  // BUG-152 Fix: Escape HTML entities in title and content
  const safeTitle = escapeHtml(article.title || '');
  const safeContent = escapeHtml(article.content || '');
  const safeSource = escapeHtml(article.source || 'Newsroom');
  
  // BUG-140 Fix: Escape URL attribute safely for Telegram
  const safeUrl = escapeUrl(article.url || '');
  const sourceLine = `🔗 <a href="${safeUrl}">${safeSource}</a>`;
  const footer = `\n\n${sourceLine}  ·  ${botAd}`;
  
  // BUG-017 Fix: Truncate safely BEFORE assembling HTML to prevent broken tags
  const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
  const maxLen = isMediaMessage ? 1024 : 4096;
  const reserveLen = safeTitle.length + footer.length + 50;
  
  let finalContent = safeContent;
  if (finalContent.length + reserveLen > maxLen) {
    finalContent = finalContent.slice(0, Math.max(0, maxLen - reserveLen - 3)) + '...';
  }
  
  // Rasm + sarlavha + tavsif + manba havolasi · bot reklamasi
  const caption = `${article.emoji || '🗞'} <b>${safeTitle}</b>\n\n${finalContent}${footer}`;

  try {
    if (!user.target_channel) {
      logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
      return;
    }

    const targets = DBService.getUserOutputChannels(user);
    await safeSendToChannels(user, targets.length ? targets : [user.target_channel], async (targetChannel) => {
      if (article.videoUrl && (await ScraperService.isValidMedia(article.videoUrl))) {
        await bot.sendVideo(targetChannel, article.videoUrl, { caption, parse_mode: "HTML" });
      } else if (article.audioUrl && (await ScraperService.isValidMedia(article.audioUrl))) {
        await bot.sendAudio(targetChannel, article.audioUrl, { caption, parse_mode: "HTML" });
      } else if (article.imageUrl && (await ScraperService.isValidMedia(article.imageUrl))) {
        await bot.sendPhoto(targetChannel, article.imageUrl, { caption, parse_mode: "HTML" });
      } else {
        await bot.sendMessage(targetChannel, caption, { parse_mode: "HTML" });
      }
    });

    await DBService.incrementStat(user.telegram_id, 'total_posts');
  } catch (e: any) {
    logger.error(`❌ safeSend Error: ${e.message}`);
    try {
      await bot.sendMessage(user.telegram_id, `⚠️ <b>Xatolik!</b>\n\nKanalingizga xabar yuborib bo'lmadi. Iltimos, botni kanalga admin qilganingizni va kanal manzili to'g'riligini tekshiring.\n\nXato: <code>${escapeHtml(e.message)}</code>`, { parse_mode: 'HTML' });
    } catch {}
    // BUG-020 Fix: Throw error so caller knows it failed and doesn't mark it as seen
    throw e;
  }
}

// BUG-152 & BUG-019 Fix: Full HTML entity escaping helper
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeUrl(text: string): string {
  return String(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
}

export { bot, notify };
