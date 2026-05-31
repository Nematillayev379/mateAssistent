"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusteringService = void 0;
const database_1 = require("./database");
const ai_1 = require("./ai");
const logger_1 = require("../utils/logger");
const bot_instance_1 = require("./bot_instance");
let cachedClusters = null;
const CACHE_TTL = 15 * 60 * 1000;
exports.ClusteringService = {
    async getClusters(force = false) {
        if (!force && cachedClusters && Date.now() - cachedClusters.at < CACHE_TTL) {
            return cachedClusters;
        }
        const titles = await database_1.DBService.getRecentNewsTitles(100);
        if (!titles.length)
            return { clusters: [], summary: "Ma'lumot yo'q.", at: Date.now() };
        const prompt = `Quyidagi yangilik sarlavhalarini mavzu bo'yicha klasterlarga ajrating.
Har bir klaster uchun: mavzu nomi, 5 tagacha sarlavha, umumiy qisqa xulosa (2 jumla).
Eng muhim 5 ta klasterni qaytaring.
JSON format: {"clusters":[{"topic":"","items":["sarlavha1","sarlavha2"],"summary":""}],"today_main":"bugungi eng muhim voqea haqida 1 jumla"}
Sarlavhalar:\n${titles.slice(0, 60).join('\n')}`;
        try {
            const raw = await (0, ai_1.getSmartAIResponse)('Siz O\'zbekiston media klasterlash mutaxassisisiz. Faqat JSON qaytaring.', prompt);
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { clusters: [], today_main: '' };
            const clusters = Array.isArray(parsed.clusters) ? parsed.clusters.slice(0, 5) : [];
            const result = { clusters, summary: parsed.today_main || '', at: Date.now() };
            cachedClusters = result;
            return result;
        }
        catch (e) {
            logger_1.logger.error(`Clustering error: ${e.message}`);
            return { clusters: [], summary: 'Klasterlash vaqtincha ishlamayapti.', at: Date.now() };
        }
    },
    async sendClusterDigest(userId, channelId) {
        const data = await this.getClusters(true);
        if (!data.clusters.length)
            return false;
        const user = await database_1.DBService.getUser(userId);
        const lang = user?.language || 'uz';
        const target = channelId || user?.target_channel || userId;
        let msg = `📊 <b>Bugungi TOP 5 mavzu</b>\n\n`;
        msg += `🔹 <i>${data.summary}</i>\n\n`;
        for (const c of data.clusters) {
            msg += `<b>${c.topic}</b>\n`;
            const items = (c.items || []).slice(0, 3);
            for (const item of items) {
                msg += `▫️ ${item}\n`;
            }
            msg += `💬 ${c.summary}\n\n`;
        }
        try {
            await bot_instance_1.bot.sendMessage(target, msg, { parse_mode: 'HTML' });
            return true;
        }
        catch (e) {
            logger_1.logger.error(`Cluster digest send failed: ${e.message}`);
            return false;
        }
    },
};
