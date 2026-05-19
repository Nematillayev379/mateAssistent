"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = void 0;
const database_1 = require("../services/database");
const config_1 = require("../config/config");
const bot_instance_1 = require("../services/bot_instance");
const i18n_1 = require("../services/i18n");
const logger_1 = require("../utils/logger");
function getLanguageKeyboard() {
    const labels = {
        uz: "O'zbek",
        ru: "Русский",
        en: "English",
        tr: "Türkçe",
        de: "Deutsch",
        fr: "Français",
        es: "Español",
        it: "Italiano",
        pt: "Português",
        ar: "العربية",
        hi: "हिन्दी",
        zh: "中文",
        ja: "日本語",
        ko: "한국어",
        fa: "فارسی",
    };
    const rows = [];
    for (let i = 0; i < i18n_1.WEBAPP_LANGS.length; i += 2) {
        rows.push(i18n_1.WEBAPP_LANGS.slice(i, i + 2).map((lang) => ({
            text: labels[lang],
            callback_data: `setlang_${lang}`,
        })));
    }
    return rows;
}
async function sendWelcomeMenu(bot, chatId, user, role) {
    const lang = user.language || "uz";
    const welcomeMsg = {
        owner: `👑 <b>${i18n_1.i18n.t("welcome_owner", { lng: lang })}</b>`,
        admin: `🛡 <b>${i18n_1.i18n.t("welcome_admin", { lng: lang })}</b>`,
        premium: `🚀 <b>${i18n_1.i18n.t("welcome_premium", { lng: lang })}</b>`,
        user: `🗞 <b>${i18n_1.i18n.t("welcome_user", { lng: lang })}</b>`,
    }[role] || "👋";
    const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}&v=${Date.now()}`;
    const inline_keyboard = [
        [{ text: `🖥 ${i18n_1.i18n.t("menu_dashboard", { lng: lang })}`, web_app: { url: dashboardUrl } }],
        [
            { text: `⚙️ ${i18n_1.i18n.t("menu_settings", { lng: lang })}`, callback_data: "cmd_settings" },
            { text: `📊 ${i18n_1.i18n.t("menu_stats", { lng: lang })}`, callback_data: "cmd_stats" },
        ],
        [{ text: `🎁 ${i18n_1.i18n.t("menu_referral", { lng: lang })}`, callback_data: "cmd_referral" }],
    ];
    if (role === "owner" || role === "admin") {
        inline_keyboard.unshift([{ text: `🛡 ${i18n_1.i18n.t("menu_admin", { lng: lang })}`, callback_data: "cmd_admin" }]);
    }
    if (role === "user" && !user.is_premium) {
        inline_keyboard.push([{ text: `💎 ${i18n_1.i18n.t("menu_buy_premium", { lng: lang })}`, callback_data: "buy_premium" }]);
    }
    await bot.sendMessage(chatId, `${welcomeMsg}\n\n<i>${i18n_1.i18n.t("bot_settings_panel", { lng: lang })}</i>`, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
}
exports.startCommand = {
    pattern: /\/start\s*(.*)|\/boshlash\s*(.*)|\/начать\s*(.*)/i,
    description: "Botni boshlash / Start",
    handler: async (bot, msg, match) => {
        const chatId = msg.chat.id;
        const isOwner = (0, config_1.isOwnerId)(chatId);
        const payload = (match?.[1] || match?.[2] || match?.[3] || "").trim();
        if (payload && payload.startsWith("ref_")) {
            const referrerCode = payload.replace("ref_", "").trim();
            const referrer = await database_1.DBService.getUserByReferralCode(referrerCode);
            if (referrer && referrer.telegram_id !== chatId) {
                const isNewUser = !(await database_1.DBService.getUser(chatId));
                if (isNewUser) {
                    const created = await database_1.DBService.createReferral(referrer.telegram_id, chatId);
                    if (created) {
                        logger_1.logger.info(`New referral: ${chatId} invited by ${referrer.telegram_id}`);
                        try {
                            await bot.sendMessage(referrer.telegram_id, "🎁 <b>Yangi referral!</b> Sizga bonus berildi.", { parse_mode: "HTML" });
                        }
                        catch (e) {
                            logger_1.logger.warn(`Could not notify referrer ${referrer.telegram_id}: ${e.message}`);
                        }
                    }
                }
            }
        }
        const user = await database_1.DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
        if (!user)
            return;
        if (isOwner && user.role !== "owner") {
            await database_1.DBService.updateUserRole(chatId, "owner");
            user.role = "owner";
        }
        const role = user.role || "user";
        if (!user.is_approved && !isOwner && role !== "admin" && role !== "owner") {
            await bot.sendMessage(chatId, "⏳ <b>Sizning profilingiz hali tasdiqlanmagan.</b>\n\nAdminlar tasdiqlaganidan so'ng botdan foydalanishingiz mumkin.", { parse_mode: "HTML" });
            return;
        }
        const isStaff = isOwner || role === "owner" || role === "admin";
        const dashboardUrl = `${config_1.CONFIG.PUBLIC_URL}/dashboard?token=${(0, bot_instance_1.generateDashboardToken)(chatId)}&user=${chatId}&v=${Date.now()}`;
        if (!user.target_channel) {
            if (!user.has_seen_lang) {
                const inline_keyboard = getLanguageKeyboard();
                if (isStaff) {
                    inline_keyboard.push([
                        { text: "🛡 Admin Panel", callback_data: "cmd_admin" },
                        { text: "🖥 Dashboard", web_app: { url: dashboardUrl } },
                    ]);
                }
                await bot.sendMessage(chatId, `🌍 <b>${i18n_1.i18n.t("bot_choose_language", { lng: "en" })}</b>\n\n<i>${i18n_1.i18n.t("bot_choose_language", { lng: "uz" })}</i>`, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
                await database_1.DBService.updateUser(chatId, { has_seen_lang: true });
                if (isStaff) {
                    await sendWelcomeMenu(bot, chatId, user, role);
                }
                return;
            }
            const lang = user.language || "uz";
            await bot.sendMessage(chatId, `🗞 <b>${i18n_1.i18n.t("bot_last_step", { lng: lang })}</b>\n\n${i18n_1.i18n.t("bot_send_channel_example", { lng: lang })}\n\n<i>${i18n_1.i18n.t("bot_channel_hint", { lng: lang })}</i>`, { parse_mode: "HTML" });
            if (isStaff) {
                await sendWelcomeMenu(bot, chatId, user, role);
            }
            return;
        }
        await sendWelcomeMenu(bot, chatId, user, role);
    },
};
