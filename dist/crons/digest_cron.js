"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDailyDigests = processDailyDigests;
const database_1 = require("../services/database");
const logger_1 = require("../utils/logger");
const ai_1 = require("../services/ai");
const bot_instance_1 = require("../services/bot_instance");
const i18n_1 = require("../services/i18n");
async function processDailyDigests() {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    try {
        const users = await database_1.DBService.getUsersWithDigest();
        // BUG-033 Fix: Use local timezone for 'today' date string to match now.getHours()
        const offsetMs = now.getTimezoneOffset() * 60000;
        const localNow = new Date(now.getTime() - offsetMs);
        const today = localNow.toISOString().split('T')[0];
        for (const user of users) {
            if (!user.digest_time)
                continue;
            const [targetH, targetM] = user.digest_time.split(':').map(Number);
            const targetTotal = targetH * 60 + targetM;
            const currentTotal = now.getHours() * 60 + now.getMinutes();
            if (currentTotal >= targetTotal && user.digest_last_sent !== today) {
                logger_1.logger.info(`✨ Sending daily digest to user ${user.telegram_id}`);
                // BUG-138 Fix: Always update digest_last_sent even if it fails, to avoid infinite retry loops
                await sendDigest(user);
                await database_1.DBService.updateUser(user.telegram_id, { digest_last_sent: today });
            }
        }
    }
    catch (err) {
        logger_1.logger.error(`Digest Cron Error: ${err.message}`);
    }
}
async function sendDigest(user) {
    try {
        const news = await database_1.DBService.getRecentTitlesForDigest(user.telegram_id, 24);
        if (!news || news.length === 0)
            return false;
        const lang = user.language || 'uz';
        // BUG #48 Fix: Use selectTopNews to prioritize important articles
        const { selectTopNews } = await Promise.resolve().then(() => __importStar(require('../services/ai')));
        const topNews = await selectTopNews(news.map(n => ({ title: n.title, url: n.url })));
        const titles = topNews.map((n, i) => `${i + 1}. ${n.title}`).join('\n');
        const systemPrompt = `You are a professional news anchor. Create a concise and catchy daily news digest in ${lang} language based on the following titles. 
    Focus on these specific important events. Use emojis. Keep it friendly. Output HTML formatted text for Telegram.`;
        const userPrompt = `News Titles:\n${titles}`;
        const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
        if (summary) {
            const header = `🗞 <b>${i18n_1.i18n.t('daily_digest_header', { lng: lang }) || 'Daily News Digest'}</b>\n\n`;
            // BUG-034 Fix: Try to send to target channel if they have one, fallback to PM
            const target = user.target_channel || user.telegram_id;
            await bot_instance_1.bot.sendMessage(target, header + summary, { parse_mode: 'HTML' });
            return true;
        }
        return false;
    }
    catch (err) {
        logger_1.logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
        // BUG-138 Fix: Return true on terminal errors like blocked bot to prevent retry loops
        if (err.message?.includes('Forbidden') || err.message?.includes('blocked')) {
            return true;
        }
        return false;
    }
}
