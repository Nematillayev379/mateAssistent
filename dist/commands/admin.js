"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCommand = void 0;
const config_1 = require("../config/config");
const database_1 = require("../services/database");
const bot_instance_1 = require("../services/bot_instance");
exports.adminCommand = {
    pattern: /^\/(admin|promote)\b/i,
    description: "🛡 Admin Panel & Promotion",
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        const user = await database_1.DBService.getUser(chatId);
        const isOwner = (0, config_1.isOwnerId)(chatId);
        if (user?.role !== "owner" && user?.role !== "admin" && !isOwner) {
            await bot.sendMessage(chatId, "❌ Bu buyruq faqat adminlar uchun!");
            return;
        }
        const text = msg.text || "";
        if (text.startsWith("/promote")) {
            if (!isOwner) {
                await bot.sendMessage(chatId, "❌ Promote qilish faqat haqiqiy owner (.env dagi) uchun!");
                return;
            }
            const parts = text.split(" ");
            if (parts.length < 3) {
                await bot.sendMessage(chatId, "❓ Ishlatish: <code>/promote [userId] [role]</code>\n\nRollari: admin, premium, user", { parse_mode: "HTML" });
                return;
            }
            const targetId = parseInt(parts[1]);
            if (isNaN(targetId)) {
                await bot.sendMessage(chatId, "❌ Noto'g'ri foydalanuvchi ID!");
                return;
            }
            const role = parts[2].toLowerCase();
            const roles = ["admin", "premium", "user"];
            if (!roles.includes(role)) {
                await bot.sendMessage(chatId, "❌ Noto'g'ri rol! Faqat: " + roles.join(", "));
                return;
            }
            await database_1.DBService.updateUserRole(targetId, role);
            await bot.sendMessage(chatId, `✅ Foydalanuvchi <code>${targetId}</code> roli <b>${role.toUpperCase()}</b> ga o'zgartirildi!`, { parse_mode: "HTML" });
            return;
        }
        const allUsers = await database_1.DBService.getAllUsers();
        const dashboardUrl = (0, bot_instance_1.buildDashboardUrl)(chatId);
        const report = `🛡 <b>Admin Boshqaruv Paneli</b>\n\n` +
            `👥 Jami foydalanuvchilar: <b>${allUsers.length}</b>\n` +
            `🛠 Rolni o'zgartirish: <code>/promote [ID] [ROL]</code>\n\n` +
            `mateAssistent Dashboard orqali to'liq boshqarishingiz mumkin:`;
        const inline_keyboard = [];
        if (dashboardUrl) {
            inline_keyboard.push([{ text: "🖥 mateAssistent Dashboard (Admin Mode)", web_app: { url: dashboardUrl } }]);
        }
        inline_keyboard.push([{ text: "📢 Xabar yuborish (Broadcast)", callback_data: "adm_broadcast" }]);
        await bot.sendMessage(chatId, report, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard },
        });
    },
};
