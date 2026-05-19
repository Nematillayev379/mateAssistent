"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helpCommand = void 0;
const database_1 = require("../services/database");
const config_1 = require("../config/config");
const bot_instance_1 = require("../services/bot_instance");
exports.helpCommand = {
    pattern: /^\/(help|yordam|помощь)$/i,
    description: 'ℹ️ Yordam va yo\'riqnoma / Help guide',
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        const user = await database_1.DBService.getUser(chatId);
        const lang = user?.language || 'uz';
        const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}&v=${Date.now()}`;
        const text = {
            uz: `ℹ️ <b>mateAssistent Bot — Yo'riqnoma va Buyruqlar</b>\n\n` +
                `Ushbu bot sizga yangiliklarni avtomatik ravishda yig'ish, ularni AI yordamida qayta ishlash, o'zbek tiliga tarjima qilish hamda kanalingizga avtomatik chop etishda yordam beradi. Shuningdek, botda media yuklab olish va narxlarni kuzatish tizimi mavjud.\n\n` +
                `🤖 <b>Tizim Buyruqlari:</b>\n` +
                `• /start — Bosh sahifa va boshqaruv menyusi\n` +
                `• /status — Shaxsiy faoliyat statistikangiz (grafik bilan)\n` +
                `• /setchannel &lt;kanal&gt; — Target kanalingizni o'zgartirish (masalan: <code>/setchannel @kanalingiz</code>)\n` +
                `• /track &lt;link&gt; — Olx yoki Uzum-dan mahsulot narxini kuzatish (narx pasayganda bot sizga xabar beradi)\n` +
                `• /help — Ushbu yo'riqnomani ko'rish\n\n` +
                `📹 <b>Media va Musiqa Yuklash:</b>\n` +
                `Siz botga YouTube, Instagram, TikTok, SoundCloud yoki Spotify havolalarini yuborganingizda, bot ularni avtomatik aniqlaydi va sizga MP3 yoki MP4 formatida yuklab olishni taklif qiladi.\n\n` +
                `🖥 <b>Veb Boshqaruv Paneli (Dashboard):</b>\n` +
                `Rss manbalarni qo'shish, AI yozish stili, kanalingiz xulosasi va premium rejimlarni to'liq boshqarish uchun <b>mateAssistent Dashboard</b>ga kiring.`,
            ru: `ℹ️ <b>mateAssistent Bot — Руководство и Команды</b>\n\n` +
                `Этот бот помогает автоматически собирать новости, обрабатывать их с помощью AI, переводить на узбекский язык и автоматически публиковать на вашем канале. Также есть функции скачивания медиа и отслеживания цен.\n\n` +
                `🤖 <b>Доступные Команды:</b>\n` +
                `• /start — Главная страница и панель управления\n` +
                `• /status — Ваша личная статистика (с графиком)\n` +
                `• /setchannel &lt;канал&gt; — Изменить целевой канал (например: <code>/setchannel @vashkanal</code>)\n` +
                `• /track &lt;ссылка&gt; — Отслеживать цену на Olx или Uzum (бот сообщит при снижении цены)\n` +
                `• /help — Показать эту справку\n\n` +
                `📹 <b>Скачивание Медиа и Музыки:</b>\n` +
                `Когда вы отправляете боту ссылку на YouTube, Instagram, TikTok, SoundCloud или Spotify, бот автоматически распознает её и предложит скачать в формате MP3 или MP4.\n\n` +
                `🖥 <b>Веб-панель управления (Dashboard):</b>\n` +
                `Для добавления RSS-источников, настройки стиля AI, подписей и премиум-тарифов перейдите в <b>mateAssistent Dashboard</b>.`,
            en: `ℹ️ <b>mateAssistent Bot — Help and Instructions</b>\n\n` +
                `This bot automates news aggregation, processes content with advanced AI, translates to Uzbek, and publishes instantly to your Telegram channel. It also features media downloading and item price tracking.\n\n` +
                `🤖 <b>Bot Commands:</b>\n` +
                `• /start — Home page and main management buttons\n` +
                `• /status — View your publishing statistics (with chart)\n` +
                `• /setchannel &lt;channel&gt; — Change target channel (e.g. <code>/setchannel @yourchannel</code>)\n` +
                `• /track &lt;url&gt; — Track product prices on Olx or Uzum (notifies you if the price drops)\n` +
                `• /help — Show this help manual\n\n` +
                `📹 <b>Media Downloader:</b>\n` +
                `Send any link from YouTube, Instagram, TikTok, SoundCloud, or Spotify, and the bot will recognize it to download in high-quality MP3 or MP4 formats.\n\n` +
                `🖥 <b>Web Dashboard:</b>\n` +
                `Access the <b>mateAssistent Dashboard</b> to configure RSS sources, customize AI writing tones, sign posts, or buy Premium plans.`
        }[lang] || `ℹ️ <b>mateAssistent Bot — Help Guide</b>`;
        const inline_keyboard = [
            [{ text: "🖥 Dashboard", web_app: { url: dashboardUrl } }],
            [{ text: "⚙️ Sozlamalar / Settings", callback_data: 'cmd_settings' }]
        ];
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
    }
};
