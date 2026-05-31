"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrendsService = void 0;
const database_1 = require("./database");
const ai_1 = require("./ai");
const logger_1 = require("../utils/logger");
const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedTrends = null;
exports.TrendsService = {
    async scanUZTrends(force = false) {
        if (!force && cachedTrends && Date.now() - cachedTrends.at < CACHE_TTL_MS) {
            return cachedTrends;
        }
        const titles = await database_1.DBService.getRecentNewsTitles(100);
        if (!titles.length) {
            return { topics: [], summary: "Hozircha yetarli ma'lumot yo'q.", at: Date.now() };
        }
        const prompt = `Quyidagi O'zbekiston yangilik sarlavhalaridan TOP 8 trend mavzuni aniqlang.
Har mavzu uchun: nom, qiziqish (1-100), qisqa izoh (1 jumla).
JSON format: {"topics":[{"name":"","score":0,"note":""}],"summary":"..."}
Sarlavhalar:\n${titles.slice(0, 60).join('\n')}`;
        try {
            const raw = await (0, ai_1.getSmartAIResponse)('Siz O\'zbekiston media trend tahlilchisisiz. Faqat JSON qaytaring.', prompt);
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { topics: [], summary: raw };
            const result = {
                topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 10) : [],
                summary: parsed.summary || '',
                at: Date.now(),
            };
            cachedTrends = result;
            await database_1.DBService.saveTrendsSnapshot(result.topics, result.summary);
            return result;
        }
        catch (e) {
            logger_1.logger.error(`Trends scan error: ${e.message}`);
            return { topics: [], summary: 'Trend tahlili vaqtincha ishlamayapti.', at: Date.now() };
        }
    },
};
