import TelegramBot from "node-telegram-bot-api";
import { startCommand } from "./start";
import { statusCommand } from "./status";
import { trackCommand } from "./track";
import { adminCommand } from "./admin";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { logger } from "../utils/logger";
import { i18n } from "../services/i18n";
import { CONFIG } from "../config/config";
import { ScraperService } from '../services/scraper';
import { addAIJob, isRedisAvailable } from '../services/queue';
import { getRedisConnection } from '../services/redis';
import { getSmartAIResponse } from '../services/ai';
import { generateDashboardToken } from '../services/bot_instance';

export const commands: BotCommand[] = [
  startCommand,
  statusCommand,
  trackCommand,
  adminCommand,
];

export function registerCommands(bot: TelegramBot) {
  const userStates = new Map<number, { type: string, url: string }>();

  // 1. Generic Message Handler (Links, Onboarding, States)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    logger.info(`📩 Incoming: "${text}" from ${chatId}`);

    // If it's a command, let onText handle it (mostly)
    if (text.startsWith('/')) return;

    const user = await DBService.getUser(chatId);
    const lang = user?.language || 'uz';

    // A. Onboarding: Capture Target Channel
    if (!user?.target_channel && (text.startsWith('@') || text.startsWith('-100'))) {
       try {
         const chat = await bot.getChat(text);
         const member = await bot.getChatMember(chat.id, (await bot.getMe()).id);
         if (member.status === 'administrator' || member.status === 'creator') {
            await DBService.updateUser(chatId, { target_channel: text });
            
            // BUG #47 Fix: Activate referral if applicable
            await DBService.checkAndMarkReferralActive(chatId);
            
            await bot.sendMessage(chatId, "✅ " + i18n.t('onboarding_success', { lng: lang }));
            return;
         } else {
            // BUG #89 Fix: Explicitly notify if not admin
            await bot.sendMessage(chatId, "❌ Bot ushbu kanalda administrator emas! Iltimos, botni admin qilib qaytadan urinib ko'ring.");
            return;
         }
       } catch (e) {
         await bot.sendMessage(chatId, i18n.t('err_invalid_channel', { lng: lang }));
         return;
       }
    }

    // B. States: Capture Time for Scheduling (Bug #35 Fix: Robust Date)
    const state = userStates.get(chatId);
    if (state?.type === 'schedule_time' && msg.text && /^\d{1,2}:\d{2}$/.test(msg.text)) {
       const [h, m] = msg.text.split(':').map(Number);
       if (h < 0 || h > 23 || m < 0 || m > 59) {
         return bot.sendMessage(chatId, "❌ Noto'g'ri vaqt kiritildi. Iltimos 00:00 - 23:59 oraliqda kiriting.");
       }
       
       const now = new Date();
       const scheduledDate = new Date();
       scheduledDate.setHours(h, m, 0, 0);
       if (scheduledDate <= now) scheduledDate.setDate(scheduledDate.getDate() + 1);

       // Bug #33 & #34 Fix: Dynamic Type and Caption
       const mediaType = (state as any).mediaType || 'video';
       const article = await ScraperService.scrapeArticle(state.url).catch(() => null);
       const caption = article?.title ? `🗞 <b>${article.title}</b>\n\n${article.content?.slice(0, 400)}` : "Scheduled Post";

       await DBService.addScheduledPost(chatId, mediaType, { url: state.url, caption }, scheduledDate.toISOString());
       userStates.delete(chatId);
       
       const formattedDate = scheduledDate.toLocaleString('uz-UZ', { 
         timeZone: 'Asia/Tashkent',
         day: '2-digit',
         month: '2-digit',
         year: 'numeric',
         hour: '2-digit',
         minute: '2-digit'
       });
       await bot.sendMessage(chatId, `✅ <b>Post rejalashtirildi!</b>\n\nSana: ${formattedDate}`, { parse_mode: 'HTML' });
       return;
    }

    // D. Admin Broadcast (Bug #49 handler support)
    const adminState = userStates.get(chatId);
    if (adminState?.type === 'admin_broadcast' && text) {
      if (user?.role !== 'owner') return;
      const users = await DBService.getAllUsers();
      let count = 0;
      await bot.sendMessage(chatId, `⏳ ${users.length} ta foydalanuvchiga yuborilmoqda...`);
      for (const u of users) {
        try {
          await bot.sendMessage(u.telegram_id, text, { parse_mode: 'HTML' });
          count++;
        } catch {}
      }
      await bot.sendMessage(chatId, `✅ <b>Broadcast yakunlandi!</b>\n\nJami: ${count} ta foydalanuvchiga yuborildi.`, { parse_mode: 'HTML' });
      userStates.delete(chatId);
      return;
    }

    // E. Detect Media Links
    if (msg.text && /youtube\.com|youtu\.be|instagram\.com|tiktok\.com|soundcloud\.com/.test(msg.text)) {
       const isPlaylist = msg.text.includes('playlist') || msg.text.includes('list=') || msg.text.includes('/sets/');
       const prompt = `📹 <b>${i18n.t('media_detected', { lng: lang }) || 'Media Link Detected!'}</b>\n\n${isPlaylist ? '📝 <b>Playlist aniqlandi!</b>\n\n' : ''}${i18n.t('download_ask', { lng: lang }) || 'Choose format to download:'}`;
       
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
       
       await bot.sendMessage(chatId, prompt, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
    }
  });

  // 2. Command Handlers
  for (const cmd of commands) {
    bot.onText(cmd.pattern, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
      try {
        logger.info(`🎯 Pattern Match: ${cmd.pattern} by ${msg.from?.id}`);
        await cmd.handler(bot, msg, match);
      } catch (error: any) {
        logger.error(`Error handling ${cmd.pattern}: ${error.message}`);
      }
    });
  }

  // BUG #99 Fix: Telegram Stars (XTR) Handlers
  bot.on('pre_checkout_query', async (query) => {
    try {
      await bot.answerPreCheckoutQuery(query.id, true);
    } catch (e: any) {
      logger.error(`pre_checkout_query error: ${e.message}`);
    }
  });

  bot.on('successful_payment', async (msg) => {
    const chatId = msg.chat.id;
    const payment = msg.successful_payment;
    if (!payment) return;
    
    try {
      const payload = payment.invoice_payload;
      if (payload?.startsWith('premium_sub_')) {
        const userId = parseInt(payload.split('_')[2]);
        const days = payload.includes('_yearly') ? 365 : 30;
        await DBService.setPremium(userId, days);
        await bot.sendMessage(chatId, "💎 <b>Premium faollashtirildi!</b>\n\nBarcha imkoniyatlardan foydalanishingiz mumkin.", { parse_mode: 'HTML' });
        logger.info(`💰 Payment success: User ${userId} bought ${days} days premium.`);
      }
    } catch (e: any) {
      logger.error(`successful_payment error: ${e.message}`);
    }
  });

  // 3. Centralized Callback Query Handler
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    if (!chatId || !query.data) return;
    const data = query.data;
    const user = await DBService.getUser(chatId);
    const lang = user?.language || 'uz';

    // BUG #10: Robust cleanup for userStates
    const now = Date.now();
    for (const [id, state] of userStates.entries()) {
      if ((state as any).createdAt && now - (state as any).createdAt > 30 * 60 * 1000) {
        userStates.delete(id);
      }
    }

    try {
      if (data.startsWith('setlang_')) {
        let newLang = data.split('_')[1];
        
        // BUG #93 Fix: Handle emoji extraction correctly for O'zbek
        if (data === 'setlang_🇺🇿') newLang = 'uz';
        else if (data === 'setlang_🇷🇺') newLang = 'ru';
        else if (data === 'setlang_🇺🇸') newLang = 'en';

        await DBService.updateUser(chatId, { language: newLang });
        await bot.answerCallbackQuery(query.id, { text: "✅" });
        const token = generateDashboardToken(chatId);
        await bot.sendMessage(chatId, "Newsroom Elite Dashboard: " + CONFIG.PUBLIC_URL + "/dashboard?user=" + chatId + "&token=" + token);
        return; // BUG #113 Fix: Return to avoid double answer
      } else if (data.startsWith('dl_media_')) {
        const type = data.split('_')[2] as 'video' | 'audio';
        
        // BUG #9 Fix: Robust URL extraction
        let url = (query.message as any).reply_to_message?.text;
        if (!url) {
           const entities = (query.message as any).reply_to_message?.entities || [];
           const text = (query.message as any).reply_to_message?.text || "";
           const urlEntity = entities.find((e: any) => e.type === 'url' || e.type === 'text_link');
           if (urlEntity) {
             url = urlEntity.type === 'url' ? text.substring(urlEntity.offset, urlEntity.offset + urlEntity.length) : urlEntity.url;
           }
        }
        if (!url) url = (query.message as any).text?.match(/(https?:\/\/[^\s]+)/)?.[0];

        if (!url) {
          await bot.answerCallbackQuery(query.id, { text: "❌ Havola topilmadi", show_alert: true });
          return;
        }

        // BUG #19: SoundCloud/Generic safety
        if (url.includes('soundcloud.com') && type === 'video') {
          await bot.answerCallbackQuery(query.id, { text: "🎵 SoundCloud faqat Audio (MP3) formatida ishlaydi", show_alert: true });
          return;
        }

        const waitMsg = await bot.sendMessage(chatId, `⏳ ${i18n.t('processing', { lng: lang })}...`);
        try {
          const { downloadYouTube } = await import('../services/youtube');
          const filePath = await downloadYouTube(url, type);
          if (type === 'video') await bot.sendVideo(chatId, filePath);
          else await bot.sendAudio(chatId, filePath);
          await bot.deleteMessage(chatId, waitMsg.message_id);
          const fs = await import('fs');
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err: any) {
          await bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: waitMsg.message_id });
        }
      } else if (data === 'schedule_media') {
        const canSchedule = await DBService.checkUserLimit(chatId, 'scheduled');
        if (!canSchedule) return bot.sendMessage(chatId, "⭐ <b>Limitga yetdingiz!</b>");
        
        // Extract media type from context or ask (default to video for now but detect if audio)
        const url = (query.message as any).reply_to_message?.text || (query.message as any).text?.match(/(https?:\/\/[^\s]+)/)?.[0];
        if (!url) return bot.sendMessage(chatId, "❌ Link topilmadi.");

        userStates.set(chatId, { type: 'schedule_time', url, createdAt: Date.now() } as any);
        await bot.sendMessage(chatId, "⏰ <b>Post qachon chiqsin? (SS:DD formatida, masalan: 18:30):</b>", { parse_mode: 'HTML' });
      } else if (data === 'cancel_dl') {
        await bot.deleteMessage(chatId, query.message!.message_id);
      } else if (data === 'cmd_settings') {
        // BUG #49 Fix: Settings callback handler
        await bot.sendMessage(chatId, "⚙️ <b>Sozlamalar paneli</b>\n\nDashboard orqali barcha sozlamalarni o'zgartirishingiz mumkin.", {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: "🖥 Dashboard", web_app: { url: `${CONFIG.PUBLIC_URL}/dashboard?user=${chatId}` } }]]
          }
        });
      } else if (data === 'adm_broadcast') {
        // BUG #49 Fix: Admin broadcast callback handler
        userStates.set(chatId, { type: 'admin_broadcast', url: '', createdAt: Date.now() } as any);
        await bot.sendMessage(chatId, "📢 <b>Broadcast xabarini kiriting (HTML qo'llab-quvvatlanadi):</b>", { parse_mode: 'HTML' });
      }
      
      await bot.answerCallbackQuery(query.id);
    } catch (e: any) {
      logger.error(`Callback error: ${e.message}`);
    }
  });
}
