"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = void 0;
const database_1 = require("../services/database");
const config_1 = require("../config/config");
exports.startCommand = {
    pattern: /start|boshlash|начать/i,
    description: '🏠 Botni boshlash / Start',
    handler: async (bot, msg, match) => {
        const chatId = msg.chat.id;
        const isOwner = chatId === config_1.CONFIG.OWNER_ID;
        const user = await database_1.DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
        const lang = user?.language || 'uz';
        const role = user.role || 'user';
        // 1. Onboarding: Ask for Language first
        if (!user.language) {
            const text = "🌍 <b>Welcome! Please choose your language:</b>\n\n<i>Salom! Tilni tanlang:</i>";
            const inline_keyboard = [
                [{ text: "🇺🇿 O'zbek", callback_data: "setlang_uz" }, { text: "🇷🇺 Русский", callback_data: "setlang_ru" }],
                [{ text: "🇺🇸 English", callback_data: "setlang_en" }, { text: "🇹🇷 Türkçe", callback_data: "setlang_tr" }]
            ];
            await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            return;
        }
        // 2. Onboarding: Ask for Channel
        if (!user.target_channel) {
            const text = "🗞 <b>So'nggi qadam!</b>\n\nYangiliklar qaysi kanalga yuborilsin? Kanal nomini @belgisi bilan yuboring (Masalan: @kanalingiz).\n\n<i>Eslatma: Botni kanalingizga 'Admin' qilishingiz shart!</i>";
            await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
            return;
        }
        // 3. Elite Welcome Experience
        const welcomeMsg = {
            owner: "👑 <b>Xush kelibsiz, Janob Owner!</b>\n\nTizim 100% sizning nazoratingizda. Admin panel orqali foydalanuvchilarni boshqarishingiz mumkin.",
            admin: "🛠 <b>Admin Panelga xush kelibsiz!</b>\n\nSupport so'rovlarini ko'rib chiqish va botni boshqarish uchun dashboardga o'ting.",
            premium: "🚀 <b>Siz Premium foydalanuvchisiz!</b>\n\nBarcha cheklovlar olib tashlangan. Ommaviy yuklash va AI media xizmatlaridan foydalanishingiz mumkin.",
            user: "🗞 <b>Newsroom Botga xush kelibsiz!</b>\n\nDunyo yangiliklarini avtomatik ravishda kanalingizga joylab boring."
        }[role] || "👋 Salom!";
        const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?user=${chatId}`;
        const dashboardSecret = config_1.CONFIG.DASHBOARD_SECRET;
        const inline_keyboard = [
            [{ text: "🖥 Elite Dashboard", web_app: { url: dashboardUrl } }],
            [{ text: "⚙️ Sozlamalar", callback_data: 'cmd_settings' }, { text: "📊 Statistika", callback_data: 'cmd_stats' }],
            [{ text: "🎁 Referral Tizimi", callback_data: 'cmd_referral' }]
        ];
        if (role === 'user' && !user.is_premium) {
            inline_keyboard.push([{ text: "💎 Premium Sotib Olish", callback_data: 'buy_premium' }]);
        }
        await bot.sendMessage(chatId, welcomeMsg + `\n\n🔑 <b>Dashboard Kalitingiz:</b> <code>${dashboardSecret}</code>\n\n<i>Kalitni nusxalab oling va Dashboardga kirishda foydalaning.</i>`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
        });
    }
};
