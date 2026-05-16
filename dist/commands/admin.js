"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCommand = void 0;
const config_1 = require("../config/config");
const database_1 = require("../services/database");
const bot_instance_1 = require("../services/bot_instance");
exports.adminCommand = {
    // BUG-087 Fix: Require leading slash to prevent false matches
    pattern: /^\/(admin|promote)\b/i,
    description: '🛡 Admin Panel & Promotion',
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        const user = await database_1.DBService.getUser(chatId);
        const isOwner = (0, config_1.isOwnerId)(chatId);
        // Only owner can promote
        if (user?.role !== 'owner' && !isOwner) {
            await bot.sendMessage(chatId, "❌ Bu buyruq faqat Owner uchun!");
            return;
        }
        const text = msg.text || "";
        // Logic for /promote [userId] [role]
        if (text.startsWith('/promote')) {
            const parts = text.split(' ');
            // BUG-088 Fix: Proper validation for parts
            if (parts.length < 3) {
                await bot.sendMessage(chatId, "❓ Ishlatish: <code>/promote [userId] [role]</code>\n\nRollari: admin, premium, user", { parse_mode: 'HTML' });
                return;
            }
            const targetId = parseInt(parts[1]);
            if (isNaN(targetId)) {
                await bot.sendMessage(chatId, "❌ Noto'g'ri foydalanuvchi ID!");
                return;
            }
            const role = parts[2].toLowerCase();
            // BUG-089 Fix: Removed 'owner' from assignable roles
            const roles = ['admin', 'premium', 'user'];
            if (!roles.includes(role)) {
                await bot.sendMessage(chatId, "❌ Noto'g'ri rol! Faqat: " + roles.join(', '));
                return;
            }
            await database_1.DBService.updateUserRole(targetId, role);
            await bot.sendMessage(chatId, `✅ Foydalanuvchi <code>${targetId}</code> roli <b>${role.toUpperCase()}</b> ga o'zgartirildi!`, { parse_mode: 'HTML' });
            return;
        }
        // Default Admin View
        const allUsers = await database_1.DBService.getAllUsers();
        // BUG-090 Fix: Include token in dashboard URL
        const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}`;
        const report = `🛡 <b>Admin Boshqaruv Paneli</b>\n\n` +
            `👥 Jami foydalanuvchilar: <b>${allUsers.length}</b>\n` +
            `🛠 Rolni o'zgartirish: <code>/promote [ID] [ROL]</code>\n\n` +
            `Elite Dashboard orqali to'liq boshqarishingiz mumkin:`;
        await bot.sendMessage(chatId, report, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🖥 Elite Dashboard (Admin Mode)", web_app: { url: dashboardUrl } }],
                    [{ text: "📢 Xabar yuborish (Broadcast)", callback_data: "adm_broadcast" }]
                ]
            }
        });
    }
};
