"use strict";
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
        for (const user of users) {
            if (user.digest_time === currentTime) {
                logger_1.logger.info(`✨ Sending daily digest to user ${user.telegram_id}`);
                await sendDigest(user);
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
            return;
        const lang = user.language || 'uz';
        const titles = news.map((n, i) => `${i + 1}. ${n.title}`).join('\n');
        const systemPrompt = `You are a professional news anchor. Create a concise and catchy daily news digest in ${lang} language based on the following titles. 
    Focus on the most important events. Use emojis. Keep it friendly. Output HTML formatted text for Telegram.`;
        const userPrompt = `News Titles:\n${titles}`;
        const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, userPrompt);
        if (summary) {
            const header = `🗞 <b>${i18n_1.i18n.t('daily_digest_header', { lng: lang }) || 'Daily News Digest'}</b>\n\n`;
            await bot_instance_1.bot.sendMessage(user.telegram_id, header + summary, { parse_mode: 'HTML' });
        }
    }
    catch (err) {
        logger_1.logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
    }
}
