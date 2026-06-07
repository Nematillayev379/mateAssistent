import { DBService } from './database';
import { getSmartAIResponse } from './ai';
import { logger } from '../utils/logger';

interface TrendTopic {
  name: string;
  score: number;
  note: string;
}

interface TrendResult {
  topics: TrendTopic[];
  summary: string;
  at: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedTrends: TrendResult | null = null;

export const TrendsService = {
  async scanUZTrends(force = false) {
    if (!force && cachedTrends && Date.now() - cachedTrends.at < CACHE_TTL_MS) {
      return cachedTrends;
    }

    const titles = await DBService.getRecentNewsTitles(100);
    if (!titles.length) {
      return { topics: [], summary: "Hozircha yetarli ma'lumot yo'q.", at: Date.now() };
    }

    const prompt = `Quyidagi O'zbekiston yangilik sarlavhalaridan TOP 8 trend mavzuni aniqlang.
Har mavzu uchun: nom, qiziqish (1-100), qisqa izoh (1 jumla).
JSON format: {"topics":[{"name":"","score":0,"note":""}],"summary":"..."}
Sarlavhalar:\n${titles.slice(0, 60).join('\n')}`;

    try {
      const raw = await getSmartAIResponse(
        'Siz O\'zbekiston media trend tahlilchisisiz. Faqat JSON qaytaring.',
        prompt
      );
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { topics: [], summary: raw };
      const result = {
        topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 10) : [],
        summary: parsed.summary || '',
        at: Date.now(),
      };
      cachedTrends = result;
      await DBService.saveTrendsSnapshot(result.topics, result.summary);
      return result;
    } catch (e: unknown) {
      logger.error(`Trends scan error: ${e instanceof Error ? e.message : String(e)}`);
      return { topics: [], summary: 'Trend tahlili vaqtincha ishlamayapti.', at: Date.now() };
    }
  },
};
