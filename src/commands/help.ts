import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { buildDashboardUrl } from "../services/bot_instance";

export const helpCommand: BotCommand = {
  pattern: /^\/(help|yordam|Ð¿Ð¾Ð¼Ð¾Ñ‰ÑŒ)$/i,
  description: 'â„¹ï¸ Yordam va yo\'riqnoma / Help guide',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    const lang = ((['uz', 'ru', 'en'].includes(user?.language || '') ? user?.language : 'en') || 'en') as 'uz' | 'ru' | 'en';
    const dashboardUrl = buildDashboardUrl(chatId);

    const text = {
      uz: `\u2139\ufe0f <b>mateAssistent Bot \u2014 Yo'riqnoma va Buyruqlar</b>\n\n` +
          `Ushbu bot sizga yangiliklarni avtomatik ravishda yig'ish, ularni AI yordamida qayta ishlash, o'zbek tiliga tarjima qilish hamda kanalingizga avtomatik chop etishda yordam beradi. Shuningdek, botda media yuklab olish va narxlarni kuzatish tizimi mavjud.\n\n` +
          `\u{1F916} <b>Tizim Buyruqlari:</b>\n` +
          `\u2022 /start \u2014 Bosh sahifa va boshqaruv menyusi\n` +
          `\u2022 /status \u2014 Shaxsiy faoliyat statistikangiz (grafik bilan)\n` +
          `\u2022 /setchannel &lt;kanal&gt; \u2014 Target kanalingizni o'zgartirish (masalan: <code>/setchannel @kanalingiz</code>)\n` +
          `\u2022 /track &lt;link&gt; \u2014 Olx yoki Uzum-dan mahsulot narxini kuzatish (narx pasayganda bot sizga xabar beradi)\n` +
          `\u2022 /help \u2014 Ushbu yo'riqnomani ko'rish\n\n` +
          `\u{1F4F9} <b>Media va Musiqa Yuklash:</b>\n` +
          `Siz botga YouTube, Instagram, TikTok, SoundCloud yoki Spotify havolalarini yuborganingizda, bot ularni avtomatik aniqlaydi va sizga MP3 yoki MP4 formatida yuklab olishni taklif qiladi.\n\n` +
          `\u{1F5A5} <b>Veb Boshqaruv Paneli (Dashboard):</b>\n` +
          `Rss manbalarni qo'shish, AI yozish stili, kanalingiz xulosasi va premium rejimlarni to'liq boshqarish uchun <b>mateAssistent Dashboard</b>ga kiring.`,
      ru: `\u2139\ufe0f <b>mateAssistent Bot \u2014 \u0420\u0443\u043a\u043e\u0432\u043e\u0434\u0441\u0442\u0432\u043e \u0438 \u041a\u043e\u043c\u0430\u043d\u0434\u044b</b>\n\n` +
          `\u042d\u0442\u043e\u0442 \u0431\u043e\u0442 \u043f\u043e\u043c\u043e\u0433\u0430\u0435\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0441\u043e\u0431\u0438\u0440\u0430\u0442\u044c \u043d\u043e\u0432\u043e\u0441\u0442\u0438, \u043e\u0431\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u0442\u044c \u0438\u0445 \u0441 \u043f\u043e\u043c\u043e\u0449\u044c\u044e AI, \u043f\u0435\u0440\u0435\u0432\u043e\u0434\u0438\u0442\u044c \u043d\u0430 \u0443\u0437\u0431\u0435\u043a\u0441\u043a\u0438\u0439 \u044f\u0437\u044b\u043a \u0438 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c \u043d\u0430 \u0432\u0430\u0448\u0435\u043c \u043a\u0430\u043d\u0430\u043b\u0435. \u0422\u0430\u043a\u0436\u0435 \u0435\u0441\u0442\u044c \u0444\u0443\u043d\u043a\u0446\u0438\u0438 \u0441\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u044f \u043c\u0435\u0434\u0438\u0430 \u0438 \u043e\u0442\u0441\u043b\u0435\u0436\u0438\u0432\u0430\u043d\u0438\u044f \u0446\u0435\u043d.\n\n` +
          `\u{1F916} <b>\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u041a\u043e\u043c\u0430\u043d\u0434\u044b:</b>\n` +
          `\u2022 /start \u2014 \u0413\u043b\u0430\u0432\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0438 \u043f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f\n` +
          `\u2022 /status \u2014 \u0412\u0430\u0448\u0430 \u043b\u0438\u0447\u043d\u0430\u044f \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0430 (\u0441 \u0433\u0440\u0430\u0444\u0438\u043a\u043e\u043c)\n` +
          `\u2022 /setchannel &lt;\u043a\u0430\u043d\u0430\u043b&gt; \u2014 \u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0446\u0435\u043b\u0435\u0432\u043e\u0439 \u043a\u0430\u043d\u0430\u043b (\u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440: <code>/setchannel @vashkanal</code>)\n` +
          `\u2022 /track &lt;\u0441\u0441\u044b\u043b\u043a\u0430&gt; \u2014 \u041e\u0442\u0441\u043b\u0435\u0436\u0438\u0432\u0430\u0442\u044c \u0446\u0435\u043d\u0443 \u043d\u0430 Olx \u0438\u043b\u0438 Uzum (\u0431\u043e\u0442 \u0441\u043e\u043e\u0431\u0449\u0438\u0442 \u043f\u0440\u0438 \u0441\u043d\u0438\u0436\u0435\u043d\u0438\u0438 \u0446\u0435\u043d\u044b)\n` +
          `\u2022 /help \u2014 \u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u044d\u0442\u0443 \u0441\u043f\u0440\u0430\u0432\u043a\u0443\n\n` +
          `\u{1F4F9} <b>\u0421\u043a\u0430\u0447\u0438\u0432\u0430\u043d\u0438\u0435 \u041c\u0435\u0434\u0438\u0430 \u0438 \u041c\u0443\u0437\u044b\u043a\u0438:</b>\n` +
          `\u041a\u043e\u0433\u0434\u0430 \u0432\u044b \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u0442\u0435 \u0431\u043e\u0442\u0443 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 YouTube, Instagram, TikTok, SoundCloud \u0438\u043b\u0438 Spotify, \u0431\u043e\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0440\u0430\u0441\u043f\u043e\u0437\u043d\u0430\u0435\u0442 \u0435\u0451 \u0438 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0438\u0442 \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u0432 \u0444\u043e\u0440\u043c\u0430\u0442\u0435 MP3 \u0438\u043b\u0438 MP4.\n\n` +
          `\u{1F5A5} <b>\u0412\u0435\u0431-\u043f\u0430\u043d\u0435\u043b\u044c \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f (Dashboard):</b>\n` +
          `\u0414\u043b\u044f \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f RSS-\u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u043e\u0432, \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0441\u0442\u0438\u043b\u044f AI, \u043f\u043e\u0434\u043f\u0438\u0441\u0435\u0439 \u0438 \u043f\u0440\u0435\u043c\u0438\u0443\u043c-\u0442\u0430\u0440\u0438\u0444\u043e\u0432 \u043f\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u0432 <b>mateAssistent Dashboard</b>.`,
      en: `\u2139\ufe0f <b>mateAssistent Bot \u2014 Help and Instructions</b>\n\n` +
          `This bot automates news aggregation, processes content with advanced AI, translates to Uzbek, and publishes instantly to your Telegram channel. It also features media downloading and item price tracking.\n\n` +
          `\u{1F916} <b>Bot Commands:</b>\n` +
          `\u2022 /start \u2014 Home page and main management buttons\n` +
          `\u2022 /status \u2014 View your publishing statistics (with chart)\n` +
          `\u2022 /setchannel &lt;channel&gt; \u2014 Change target channel (e.g. <code>/setchannel @yourchannel</code>)\n` +
          `\u2022 /track &lt;url&gt; \u2014 Track product prices on Olx or Uzum (notifies you if the price drops)\n` +
          `\u2022 /help \u2014 Show this help manual\n\n` +
          `\u{1F4F9} <b>Media Downloader:</b>\n` +
          `Send any link from YouTube, Instagram, TikTok, SoundCloud, or Spotify, and the bot will recognize it to download in high-quality MP3 or MP4 formats.\n\n` +
          `\u{1F5A5} <b>Web Dashboard:</b>\n` +
          `Access the <b>mateAssistent Dashboard</b> to configure RSS sources, customize AI writing tones, sign posts, or buy Premium plans.`
    }[lang as 'uz' | 'ru' | 'en'] || `\u2139\ufe0f <b>mateAssistent Bot \u2014 Help Guide</b>`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    if (dashboardUrl) {
      inline_keyboard.push([{ text: "\u{1F5A5} Dashboard", web_app: { url: dashboardUrl } }]);
    }
    inline_keyboard.push([{ text: "\u2699\ufe0f Sozlamalar / Settings", callback_data: 'cmd_settings' }]);

    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
  }
};
