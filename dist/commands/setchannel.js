"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setChannelCommand = void 0;
const database_1 = require("../services/database");
const logger_1 = require("../utils/logger");
const i18n_1 = require("../services/i18n");
exports.setChannelCommand = {
    pattern: /^\/setchannel(?:\s+(.*))?$/i,
    description: "📢 Kanalni sozlash yoki o'zgartirish / Set channel",
    handler: async (bot, msg, match) => {
        const chatId = msg.chat.id;
        const user = await database_1.DBService.getUser(chatId);
        if (!user)
            return;
        const lang = user.language || "uz";
        let rawParam = (match?.[1] || "").trim();
        if (!rawParam) {
            await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_missing_example", { lng: lang }), { parse_mode: "HTML" });
            return;
        }
        if (rawParam.includes("t.me/")) {
            const parts = rawParam.split("t.me/");
            const handle = parts[parts.length - 1].split("/")[0].trim();
            if (handle)
                rawParam = `@${handle}`;
        }
        if (!rawParam.startsWith("@") && !rawParam.startsWith("-100") && /^[a-zA-Z0-9_]{5,32}$/.test(rawParam)) {
            rawParam = `@${rawParam}`;
        }
        if (!rawParam.startsWith("@") && !rawParam.startsWith("-100")) {
            await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_invalid_format", { lng: lang }), { parse_mode: "HTML" });
            return;
        }
        const waitMsg = await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_checking", { lng: lang }));
        try {
            const chat = await bot.getChat(rawParam);
            const botInfo = await bot.getMe();
            const member = await bot.getChatMember(chat.id, botInfo.id);
            if (member.status === "administrator" || member.status === "creator") {
                const saved = await database_1.DBService.updateUser(chatId, { target_channel: rawParam });
                if (!saved) {
                    await bot.editMessageText(i18n_1.i18n.t("setchannel_save_failed_db", { lng: lang }), {
                        chat_id: chatId,
                        message_id: waitMsg.message_id,
                    });
                    return;
                }
                await database_1.DBService.checkAndMarkReferralActive(chatId);
                await bot.editMessageText(`${i18n_1.i18n.t("setchannel_success", { lng: lang })}\n\n${i18n_1.i18n.t("target_channel_label", { lng: lang })}: <b>${rawParam}</b>`, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: "HTML" });
            }
            else {
                await bot.editMessageText(i18n_1.i18n.t("setchannel_not_admin", { lng: lang }), {
                    chat_id: chatId,
                    message_id: waitMsg.message_id,
                    parse_mode: "HTML",
                });
            }
        }
        catch (e) {
            logger_1.logger.warn(`Failed to link channel ${rawParam} for user ${chatId}: ${e.message}`);
            await bot.editMessageText(`${i18n_1.i18n.t("setchannel_error", { lng: lang })}\n\n${i18n_1.i18n.t("setchannel_verify_public", { lng: lang })}\n\n${e.message}`, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: "HTML" });
        }
    }
};
