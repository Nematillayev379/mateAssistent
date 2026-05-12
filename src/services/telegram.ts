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

  // ── CALLBACK QUERIES ─────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId || !query.data) return;

    logger.info(`🖱 Callback: ${query.data} from ${chatId}`);
    
    const user = await DBService.getUser(chatId);
    const lang = user?.language || 'uz';

    if (query.data.startsWith('set_lang_')) {
      const newLang = query.data.replace('set_lang_', '');
      await DBService.updateUser(chatId, { language: newLang });
      await bot.answerCallbackQuery(query.id, { text: "✅" });
      await bot.sendMessage(chatId, i18n.t('onboarding_success', { lng: newLang }));
      return;
    }

    if (query.data.startsWith('dl_media_')) {
      const parts = query.data.split('_');
      const type = parts[2] as 'video' | 'audio';
      const url = (query.message as any).reply_to_message?.text || (query.message as any).text;
      
      if (!url || !url.startsWith('http')) {
        await bot.sendMessage(chatId, i18n.t('err_invalid_url', { lng: lang }) || "❌ Noto'g'ri havola");
        return;
      }

      const waitMsg = await bot.sendMessage(chatId, `⏳ ${i18n.t('processing', { lng: lang }) || 'Processing...'}`);
      
      try {
        const { downloadYouTube } = await import('./youtube');
        const filePath = await downloadYouTube(url, type);
        
        if (type === 'video') {
          await bot.sendVideo(chatId, filePath);
        } else {
          await bot.sendAudio(chatId, filePath);
        }
        
        await bot.deleteMessage(chatId, waitMsg.message_id);
        // Cleanup file
        const fs = await import('fs');
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err: any) {
        await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
      }
    } else if (query.data === 'dl_playlist_all') {
      const canDownload = await DBService.checkUserLimit(chatId, 'scheduled'); // Using 'scheduled' as a proxy for bulk for now
      const isPremium = await DBService.isPremiumActive(chatId);
      
      if (!isPremium) {
        await bot.sendMessage(chatId, "⭐ <b>Premium kerak!</b>\n\nOmmaviy yuklash faqat Premium foydalanuvchilar uchun ochiq.", { parse_mode: 'HTML' });
        return;
      }

      const url = (query.message as any).reply_to_message?.text || (query.message as any).text;
      const waitMsg = await bot.sendMessage(chatId, `🔍 Playlist tahlil qilinmoqda...`);
      
      try {
        const { YoutubeService } = await import('./youtube');
        const links = await YoutubeService.extractPlaylistLinks(url, 20);
        
        if (links.length === 0) throw new Error("Playlist bo'sh yoki havolalarni olishda xatolik");

        await bot.editMessageText(`✅ ${links.length} ta fayl topildi. Yuklash boshlandi...`, { chat_id: chatId, message_id: waitMsg.message_id });

        const { downloadYouTube } = await import('./youtube');
        const fs = await import('fs');

        for (const link of links) {
          try {
            const filePath = await downloadYouTube(link.url, 'audio');
            await bot.sendAudio(chatId, filePath, { caption: link.title });
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (e: any) {
            await bot.sendMessage(chatId, `❌ Error (${link.title}): ${e.message}`);
          }
        }
        await bot.deleteMessage(chatId, waitMsg.message_id);
      } catch (err: any) {
        await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
      }
    } else if (query.data === 'schedule_media') {
      const canSchedule = await DBService.checkUserLimit(chatId, 'scheduled');
      if (!canSchedule) {
        await bot.sendMessage(chatId, "⭐ <b>Limitga yetdingiz!</b>\n\nBepul foydalanuvchilar faqat 3 ta rejalashtirilgan postga ega bo'lishi mumkin. Premiumga o'ting.");
        return;
      }

      const url = (query.message as any).reply_to_message?.text || (query.message as any).text;
      userStates.set(chatId, { type: 'schedule_time', url });
      await bot.sendMessage(chatId, "⏰ <b>Post qachon chiqsin?</b>\n\nVaqtni SS:DD formatida yuboring (Masalan: 09:00 yoki 18:30):", { parse_mode: 'HTML' });
    } else if (query.data === 'cancel_dl') {
      try { await bot.deleteMessage(chatId, query.message!.message_id); } catch {}
    }
    
    await bot.answerCallbackQuery(query.id);
  });

  // ── GENERIC MESSAGE HANDLER (Links, Music, etc.) ─────────────────
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    const lang = user?.language || 'uz';

    // 2. Onboarding: Capture Target Channel
    if (!user?.target_channel && msg.text && (msg.text.startsWith('@') || msg.text.startsWith('-100'))) {
       try {
         const chat = await bot.getChat(msg.text);
         const member = await bot.getChatMember(chat.id, (await bot.getMe()).id);
         
         if (member.status === 'administrator' || member.status === 'creator') {
            await DBService.updateUser(chatId, { target_channel: msg.text });
            await bot.sendMessage(chatId, "✅ " + i18n.t('onboarding_success', { lng: lang }));
            return;
         }
       } catch (e) {
         await bot.sendMessage(chatId, i18n.t('err_invalid_channel', { lng: lang }));
         return;
       }
    }

    // 3. Scheduling: Capture Time
    const state = userStates.get(chatId);
    if (state?.type === 'schedule_time' && msg.text && /^\d{2}:\d{2}$/.test(msg.text)) {
       const [h, m] = msg.text.split(':').map(Number);
       const scheduledDate = new Date();
       scheduledDate.setHours(h, m, 0, 0);
       // If time passed, schedule for tomorrow
       if (scheduledDate < new Date()) scheduledDate.setDate(scheduledDate.getDate() + 1);

       await DBService.addScheduledPost(chatId, 'video', { url: state.url, caption: "Scheduled Post" }, scheduledDate.toISOString());
       userStates.delete(chatId);
       await bot.sendMessage(chatId, `✅ <b>Post rejalashtirildi!</b>\n\nSana: ${scheduledDate.toLocaleString()}`, { parse_mode: 'HTML' });
       return;
    }

    // Detect YouTube/Instagram/TikTok links
    if (/youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/.test(msg.text)) {
       const isPlaylist = msg.text.includes('playlist') || msg.text.includes('list=') || msg.text.includes('/sets/');
       const text = `📹 <b>${i18n.t('media_detected', { lng: lang }) || 'Media Link Detected!'}</b>\n\n${isPlaylist ? '📝 <b>Playlist aniqlandi!</b>\n\n' : ''}${i18n.t('download_ask', { lng: lang }) || 'Choose format to download:'}`;
       
       const inline_keyboard: any[][] = [];
       if (isPlaylist) {
         inline_keyboard.push([{ text: "📥 Ommaviy yuklash (Bulk Download)", callback_data: `dl_playlist_all` }]);
       }
       inline_keyboard.push([
         { text: "📹 Video (MP4)", callback_data: `dl_media_video` }, 
         { text: "🎵 Audio (MP3)", callback_data: `dl_media_audio` }
       ]);
       inline_keyboard.push([{ text: "📅 Rejalashtirish (Schedule)", callback_data: `schedule_media` }]);
       inline_keyboard.push([{ text: "❌ " + (i18n.t('cancel', { lng: lang }) || 'Cancel'), callback_data: `cancel_dl` }]);
       
       await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
    }
  });

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
    // Fallback to polling if no public URL
    await bot.deleteWebHook().catch(() => {});
    bot.startPolling({ polling: { interval: 2000 } });
    logger.info(`🚀 Polling started (Development mode)`);
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
  const botUser = (await bot.getMe()).username;
  const viralFooter = `\n\n🤖 <a href="https://t.me/${botUser}">@${botUser}</a> ${i18n.t('viral_tag', { lng: lang }) || 'bilan yaratildi. Siz ham qo\'shing!'}`;
  const caption = `${article.emoji || '🗞'} <b>${article.title}</b>\n\n${article.content}${viralFooter}\n\n🔗 <a href="${article.url}">${article.source}</a>`;

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
