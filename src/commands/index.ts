import TelegramBot from "node-telegram-bot-api";
import { startCommand } from "./start";
import { statusCommand } from "./status";
import { trackCommand } from "./track";
import { adminCommand } from "./admin";
import { BotCommand } from "../types";

export const commands: BotCommand[] = [
  startCommand,
  statusCommand,
  trackCommand,
  adminCommand,
];

export function registerCommands(bot: TelegramBot) {
  for (const cmd of commands) {
    bot.onText(cmd.pattern, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
      try {
        await cmd.handler(bot, msg, match);
      } catch (error) {
        console.error(`Error handling command ${cmd.pattern}:`, error);
      }
    });
  }
}
