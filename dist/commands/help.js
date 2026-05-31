"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helpCommand = void 0;
const database_1 = require("../services/database");
const bot_instance_1 = require("../services/bot_instance");
const i18n_1 = require("../services/i18n");
exports.helpCommand = {
    pattern: /^\/(help|yordam|помощь)$/i,
    description: "ℹ️ Yordam va yo'riqnoma / Help guide",
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        const user = await database_1.DBService.getUser(chatId);
        const lang = ((["uz", "ru", "en"].includes(user?.language || "") ? user?.language : "en") || "en");
        const dashboardUrl = (0, bot_instance_1.buildDashboardUrl)(chatId);
        const text = [
            `ℹ️ <b>${i18n_1.i18n.t("help_title", { lng: lang })}</b>`,
            "",
            i18n_1.i18n.t("help_intro", { lng: lang }),
            "",
            `🤖 <b>${i18n_1.i18n.t("help_commands_title", { lng: lang })}</b>`,
            `• /start — ${i18n_1.i18n.t("help_cmd_start", { lng: lang })}`,
            `• /status — ${i18n_1.i18n.t("help_cmd_status", { lng: lang })}`,
            `• /setchannel — ${i18n_1.i18n.t("help_cmd_setchannel", { lng: lang })}`,
            `• /track — ${i18n_1.i18n.t("help_cmd_track", { lng: lang })}`,
            `• /workspace — Workspace boshqaruvi`,
            `• /lang — Tilni o'zgartirish`,
            `• /help — ${i18n_1.i18n.t("help_cmd_help", { lng: lang })}`,
            `• /admin — Admin panel`,
            "",
            `📹 <b>${i18n_1.i18n.t("help_media_title", { lng: lang })}</b>`,
            i18n_1.i18n.t("help_media_body", { lng: lang }),
            "",
            `🖥 <b>${i18n_1.i18n.t("help_dashboard_title", { lng: lang })}</b>`,
            i18n_1.i18n.t("help_dashboard_body", { lng: lang }),
        ].join("\n");
        const inlineKeyboard = [];
        if (dashboardUrl) {
            inlineKeyboard.push([{ text: i18n_1.i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashboardUrl } }]);
        }
        inlineKeyboard.push([{ text: i18n_1.i18n.t("menu_settings", { lng: lang }), callback_data: "cmd_settings" }]);
        await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
    },
};
