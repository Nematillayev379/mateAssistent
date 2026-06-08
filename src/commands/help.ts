import type { TgMessage, InlineKeyboard } from "../types/telegram";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { buildDashboardUrl } from "../services/bot_instance";
import { i18n } from "../services/i18n";
import { logger } from "../utils/logger";

export const helpCommand: BotCommand = {
  pattern: /^\/(help|yordam|помощь)$/i,
  description: "ℹ️ Yordam va yo'riqnoma / Help guide",
  handler: async (bot: any, msg: TgMessage) => {
    const chatId = msg.chat.id;
    try {
      const user = await DBService.getUser(chatId);
      const lang = ((["uz", "ru", "en"].includes(user?.language || "") ? user?.language : "en") || "en") as "uz" | "ru" | "en";
      const dashboardUrl = buildDashboardUrl(chatId);

      const text = [
        `ℹ️ <b>${i18n.t("help_title", { lng: lang })}</b>`,
        "",
        i18n.t("help_intro", { lng: lang }),
        "",
        `🤖 <b>${i18n.t("help_commands_title", { lng: lang })}</b>`,
        `• /start — ${i18n.t("help_cmd_start", { lng: lang })}`,
        `• /status — ${i18n.t("help_cmd_status", { lng: lang })}`,
        `• /setchannel — ${i18n.t("help_cmd_setchannel", { lng: lang })}`,
        `• /track — ${i18n.t("help_cmd_track", { lng: lang })}`,
        `• /workspace — Workspace boshqaruvi`,
        `• /lang — Tilni o'zgartirish`,
        `• /help — ${i18n.t("help_cmd_help", { lng: lang })}`,
        `• /admin — Admin panel`,
        "",
        `📹 <b>${i18n.t("help_media_title", { lng: lang })}</b>`,
        i18n.t("help_media_body", { lng: lang }),
        "",
        `🖥 <b>${i18n.t("help_dashboard_title", { lng: lang })}</b>`,
        i18n.t("help_dashboard_body", { lng: lang }),
      ].join("\n");

      const inlineKeyboard: InlineKeyboard = [];
      if (dashboardUrl) {
        inlineKeyboard.push([{ text: i18n.t("bot_open_dashboard", { lng: lang }), web_app: { url: dashboardUrl } }]);
      }
      inlineKeyboard.push([{ text: i18n.t("menu_settings", { lng: lang }), callback_data: "cmd_settings" }]);

      await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (e: unknown) {
      logger.error(`help command error: ${e instanceof Error ? e.message : String(e)}`);
      await bot.sendMessage(chatId, i18n.t("server_error", { lng: "en" })).catch(() => {});
    }
  },
};
