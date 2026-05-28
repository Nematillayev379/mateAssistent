import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { buildDashboardUrl } from "../services/bot_instance";

export const helpCommand: BotCommand = {
  pattern: /^\/(help|yordam|помощь)$/i,
  description: "ℹ️ Yordam va yo'riqnoma / Help guide",
  handler: async (bot: TelegramBot, msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    const lang = ((["uz", "ru", "en"].includes(user?.language || "") ? user?.language : "en") || "en") as "uz" | "ru" | "en";
    const dashboardUrl = buildDashboardUrl(chatId);

    const text = {
      uz:
        `ℹ️ <b>mateAssistent Bot — Yo'riqnoma va Buyruqlar</b>\n\n` +
        `Ushbu bot yangiliklarni avtomatik yig'adi, ularni AI yordamida qayta ishlaydi, o'zbek tiliga tarjima qiladi va kanalga avtomatik chop etadi. Shuningdek, media yuklab olish va narxlarni kuzatish funksiyalari mavjud.\n\n` +
        `🤖 <b>Tizim Buyruqlari:</b>\n` +
        `• /start — Bosh sahifa va boshqaruv menyusi\n` +
        `• /status — Shaxsiy statistika\n` +
        `• /setchannel &lt;kanal&gt; — Target kanalingizni o'zgartirish (masalan: <code>/setchannel @kanalingiz</code>)\n` +
        `• /track &lt;link&gt; — Olx yoki Uzum mahsulot narxini kuzatish\n` +
        `• /help — Ushbu yo'riqnomani ko'rish\n\n` +
        `📹 <b>Media va Musiqa Yuklash:</b>\n` +
        `YouTube, Instagram, TikTok, SoundCloud yoki Spotify havolasini yuborsangiz, bot uni aniqlaydi va MP3 yoki MP4 formatida yuklab olishni taklif qiladi.\n\n` +
        `🖥 <b>Veb Boshqaruv Paneli (Dashboard):</b>\n` +
        `RSS manbalar, AI yozish stili, kanal sozlamalari va premium rejimlarni to'liq boshqarish uchun <b>mateAssistent Dashboard</b>ga kiring.`,
      ru:
        `ℹ️ <b>mateAssistent Bot — Руководство и Команды</b>\n\n` +
        `Этот бот автоматически собирает новости, обрабатывает их с помощью AI, переводит на узбекский язык и публикует в ваш канал. Также доступны загрузка медиа и отслеживание цен.\n\n` +
        `🤖 <b>Доступные Команды:</b>\n` +
        `• /start — Главная страница и меню управления\n` +
        `• /status — Ваша статистика\n` +
        `• /setchannel &lt;канал&gt; — Изменить целевой канал (например: <code>/setchannel @vashkanal</code>)\n` +
        `• /track &lt;ссылка&gt; — Отслеживать цену товара на Olx или Uzum\n` +
        `• /help — Показать эту справку\n\n` +
        `📹 <b>Загрузка Медиа и Музыки:</b>\n` +
        `Если вы отправите боту ссылку на YouTube, Instagram, TikTok, SoundCloud или Spotify, он распознает ее и предложит скачать в формате MP3 или MP4.\n\n` +
        `🖥 <b>Веб-панель управления (Dashboard):</b>\n` +
        `Для управления RSS-источниками, стилем AI, каналом и премиум-тарифами перейдите в <b>mateAssistent Dashboard</b>.`,
      en:
        `ℹ️ <b>mateAssistent Bot — Help and Instructions</b>\n\n` +
        `This bot automatically collects news, processes it with AI, translates it into Uzbek, and publishes it to your channel. It also supports media downloading and price tracking.\n\n` +
        `🤖 <b>Bot Commands:</b>\n` +
        `• /start — Home page and main management menu\n` +
        `• /status — Your personal statistics\n` +
        `• /setchannel &lt;channel&gt; — Change your target channel (for example: <code>/setchannel @yourchannel</code>)\n` +
        `• /track &lt;link&gt; — Track product prices on Olx or Uzum\n` +
        `• /help — Show this help guide\n\n` +
        `📹 <b>Media Downloader:</b>\n` +
        `Send a YouTube, Instagram, TikTok, SoundCloud, or Spotify link and the bot will detect it and offer MP3 or MP4 download options.\n\n` +
        `🖥 <b>Web Dashboard:</b>\n` +
        `Open <b>mateAssistent Dashboard</b> to manage RSS sources, AI writing style, channel settings, and premium plans.`,
    }[lang] || `ℹ️ <b>mateAssistent Bot — Help Guide</b>`;

    const inline_keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    if (dashboardUrl) {
      inline_keyboard.push([{ text: "🖥 Dashboard", web_app: { url: dashboardUrl } }]);
    }
    inline_keyboard.push([{ text: "⚙️ Sozlamalar / Settings", callback_data: "cmd_settings" }]);

    await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
  },
};
