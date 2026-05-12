"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
exports.notify = notify;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
// Initialize bot without polling - startBot() in telegram.ts will handle it
exports.bot = new node_telegram_bot_api_1.default(config_1.CONFIG.TELEGRAM_TOKEN, { polling: false });
/**
 * Shared notify helper to send messages safely
 */
async function notify(chatId, text, options = {}) {
    try {
        return await exports.bot.sendMessage(chatId, text, { parse_mode: "HTML", ...options });
    }
    catch (e) {
        logger_1.logger.warn(`Message notify error to ${chatId}: ${e.message}`);
    }
}
