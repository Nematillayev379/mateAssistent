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
const config_1 = require("../config/config");
let digestJobRunning = false;
function getZonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const map = {};
    for (const part of parts) {
        if (part.type !== 'literal')
            map[part.type] = part.value;
    }
    return {
        date: `${map.year}-${map.month}-${map.day}`,
        hour: Number(map.hour || 0),
        minute: Number(map.minute || 0),
    };
}
async function processDailyDigests() {
    if (digestJobRunning) {
        logger_1.logger.debug('Daily digest already running; skipping this tick.');
        return;
    }
    digestJobRunning = true;
    try {
        const users = await database_1.DBService.getUsersWithDigest();
        const now = new Date();
        const zonedNow = getZonedParts(now, config_1.CONFIG.TIMEZONE);
        const currentTotal = zonedNow.hour * 60 + zonedNow.minute;
        const today = zonedNow.date;
        for (const user of users) {
            if (!user.daily_digest)
                continue;
            if (!user.digest_time)
                continue;
            const [targetH, targetM] = user.digest_time.split(':').map(Number);
            if (Number.isNaN(targetH) || Number.isNaN(targetM))
                continue;
            const targetTotal = targetH * 60 + targetM;
            const diff = currentTotal - targetTotal;
            const isOnTime = diff >= 0 && diff < 3;
            const isAfterMidnight = currentTotal < 60 && targetTotal >= 1380;
            const isMatch = isOnTime || isAfterMidnight;
            if (isMatch && user.digest_last_sent !== today) {
                logger_1.logger.info(`Sending daily digest to user ${user.telegram_id} (target=${user.digest_time}, current=${String(zonedNow.hour).padStart(2, '0')}:${String(zonedNow.minute).padStart(2, '0')})`);
                const success = await sendDigest(user, today);
                if (success) {
                    await database_1.DBService.updateUser(user.telegram_id, { digest_last_sent: today });
                }
            }
        }
    }
    catch (err) {
        logger_1.logger.error(`Digest Cron Error: ${err.message}`);
    }
    finally {
        digestJobRunning = false;
    }
}
async function sendDigest(user, today) {
    try {
        const news = await database_1.DBService.getRecentTitlesForDigest(user.telegram_id, 24);
        if (!news || news.length === 0)
            return false;
        const lang = user.language || 'uz';
        const { selectTopNews } = await Promise.resolve().then(() => __importStar(require('../services/ai')));
        const topNews = await selectTopNews(news.map(n => ({ title: n.title, url: n.url })));
        const titles = topNews.map((n, i) => `${i + 1}. ${n.title}`).join('\n');
        const systemPrompt = `You are a professional news anchor. Create a concise and catchy daily news digest in ${lang} language based on the following titles. Focus on these specific important events. Use emojis. Keep it friendly. Output HTML formatted text for Telegram.`;
        const summary = await (0, ai_1.getSmartAIResponse)(systemPrompt, `News Titles:\n${titles}`);
        if (!summary)
            return false;
        const header = `🗞 <b>${i18n_1.i18n.t('daily_digest_header', { lng: lang }) || 'Daily News Digest'}</b>\n\n`;
        const target = user.target_channel || user.telegram_id;
        await bot_instance_1.bot.sendMessage(target, header + summary, { parse_mode: 'HTML' });
        // Generate and send audio podcast version
        try {
            const podcastScript = await (0, ai_1.generateAudioSummary)('Kunlik yangiliklar podkasti', topNews.map(n => n.title).join('. '), lang);
            if (podcastScript) {
                const audio = await (0, ai_1.generateTTS)(podcastScript, lang);
                if (audio) {
                    const audioCaption = `🎙 <b>${today} audio digest</b>\n\n${podcastScript.slice(0, 200)}...`;
                    await bot_instance_1.bot.sendAudio(target, audio, { caption: audioCaption, parse_mode: 'HTML', title: `Daily Podcast ${today}`, performer: 'AI News Bot' });
                    logger_1.logger.info(`Audio digest sent to ${user.telegram_id}`);
                }
            }
        }
        catch (audioErr) {
            logger_1.logger.warn(`Audio digest failed for ${user.telegram_id}: ${audioErr.message}`);
        }
        return true;
    }
    catch (err) {
        logger_1.logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
        if (err.message?.includes('Forbidden') || err.message?.includes('blocked'))
            return true;
        return false;
    }
}
