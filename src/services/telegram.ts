import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";
import { bot, notify } from "./bot_instance";
import { registerCommands } from "../commands";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import crypto from "crypto";

const instanceId = crypto.randomUUID();

export async function startBot() {
  logger.info(`🤖 Bot instance starting (ID: ${instanceId})`);

  // Register commands
  registerCommands(bot);

  // Setup Bot Commands Menu
  await bot.setMyCommands([
    { command: 'start', description: '🏠 Boshlash' },
    { command: 'status', description: '📊 Statistika' },
    { command: 'track',  description: '🔔 Narx kuzatish' },
    { command: 'help',  description: '📚 Yordam' },
  ]).catch(e => logger.warn(`setMyCommands error: ${e.message}`));

  // ── CALLBACK QUERIES ─────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId || !query.data) return;

    logger.info(`🖱 Callback: ${query.data} from ${chatId}`);
    
    // Simple dispatcher for now
    if (query.data.startsWith('dl_yt_')) {
       await bot.sendMessage(chatId, "📥 Video/Audio yuklanmoqda... (Tez kunda)");
    } else if (query.data === 'cancel_dl') {
       await bot.deleteMessage(chatId, query.message!.message_id);
    }
    
    await bot.answerCallbackQuery(query.id);
  });

  // ── GENERIC MESSAGE HANDLER (Links, Music, etc.) ─────────────────
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;

    // Detect YouTube/Instagram links
    if (msg.text.includes('youtube.com') || msg.text.includes('youtu.be') || msg.text.includes('instagram.com')) {
       const text = `📹 <b>Multimedia havolasi aniqlandi!</b>\n\nYuklab olishni xohlaysizmi?`;
       const inline_keyboard = [
         [{ text: "📥 Yuklash", callback_data: `dl_media_manual` }],
         [{ text: "❌ Bekor qilish", callback_data: `cancel_dl` }]
       ];
       await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
    }
  });

  // Webhook vs Polling logic
  if (CONFIG.PUBLIC_URL) {
    const webhookUrl = `${CONFIG.PUBLIC_URL}/api/bot/webhook`;
    await bot.setWebHook(webhookUrl);
    logger.info(`🌐 Webhook set to: ${webhookUrl}`);
  } else {
    await bot.deleteWebHook();
    bot.startPolling();
    logger.info(`🚀 Polling started (Development mode)`);
  }

  // Startup notification
  if (CONFIG.OWNER_ID) {
    await notify(CONFIG.OWNER_ID, `🚀 <b>Newsroom Bot v11.0 Modularized</b> is active!`);
  }
}

/** 
 * Safe send with media support
 * This will be called by AI Workers
 */
export async function safeSend(user: any, article: any): Promise<void> {
  const caption = `${article.emoji || '🗞'} <b>${article.title}</b>\n\n${article.content}\n\n🔗 <a href="${article.url}">${article.source}</a>`;

  try {
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
  }
}

export { bot, notify };
