"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
exports.generateDashboardToken = generateDashboardToken;
exports.buildDashboardUrl = buildDashboardUrl;
exports.notify = notify;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const crypto_1 = __importDefault(require("crypto"));
// Initialize bot with optimized network settings for Render/Linux
exports.bot = new node_telegram_bot_api_1.default(config_1.CONFIG.TELEGRAM_TOKEN, {
    polling: false,
    filepath: false, // Optimizes memory
});
/**
 * Bug #27 Fix: Generates a unique token for each user to prevent IDOR
 */
function generateDashboardToken(userId) {
    const secret = config_1.CONFIG.DASHBOARD_SECRET || 'fallback-secret';
    return crypto_1.default.createHash('sha256').update(`${userId}:${secret}`).digest('hex').slice(0, 32);
}
function buildDashboardUrl(userId) {
    const base = String(config_1.CONFIG.PUBLIC_URL || "").trim();
    if (!/^https?:\/\//i.test(base)) {
        return null;
    }
    return `${base}/dashboard?token=${generateDashboardToken(userId)}&user=${userId}&v=${Date.now()}`;
}
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
