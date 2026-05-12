"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCommand = void 0;
const config_1 = require("../config/config");
exports.adminCommand = {
    pattern: /admin|dashboard|panel/i,
    description: '⚙️ Admin paneli',
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        if (chatId !== config_1.CONFIG.OWNER_ID)
            return;
        const text = `🛠 <b>Admin Boshqaruv Paneli</b>\n\n` +
            `Quyidagi amallardan birini tanlang:`;
        const inline_keyboard = [
            [{ text: "👥 Foydalanuvchilar", callback_data: "adm_users" }],
            [{ text: "💰 Narxlarni sozlash", callback_data: "adm_prices" }],
            [{ text: "📢 Xabar yuborish (Broadcast)", callback_data: "adm_broadcast" }],
        ];
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
    }
};
