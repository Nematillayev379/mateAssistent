import { DBService } from './database';
import { getSmartAIResponse } from './ai';
import { logger } from '../utils/logger';
import { bot } from './bot_instance';

interface ClusterItem {
  topic: string;
  items: string[];
  summary: string;
}

interface ClusterResult {
  clusters: ClusterItem[];
  summary: string;
  at: number;
}

let cachedClusters: ClusterResult | null = null;
const CACHE_TTL = 15 * 60 * 1000;

export const ClusteringService = {
  async getClusters(force = false) {
    if (!force && cachedClusters && Date.now() - cachedClusters.at < CACHE_TTL) {
      return cachedClusters;
    }

    const titles = await DBService.getRecentNewsTitles(100);
    if (!titles.length) return { clusters: [], summary: "Ma'lumot yo'q.", at: Date.now() };

    const prompt = `Quyidagi yangilik sarlavhalarini mavzu bo'yicha klasterlarga ajrating.
Har bir klaster uchun: mavzu nomi, 5 tagacha sarlavha, umumiy qisqa xulosa (2 jumla).
Eng muhim 5 ta klasterni qaytaring.
JSON format: {"clusters":[{"topic":"","items":["sarlavha1","sarlavha2"],"summary":""}],"today_main":"bugungi eng muhim voqea haqida 1 jumla"}
Sarlavhalar:\n${titles.slice(0, 60).join('\n')}`;

    try {
      const raw = await getSmartAIResponse('Siz O\'zbekiston media klasterlash mutaxassisisiz. Faqat JSON qaytaring.', prompt);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { clusters: [], today_main: '' };
      const clusters = Array.isArray(parsed.clusters) ? parsed.clusters.slice(0, 5) : [];

      const result = { clusters, summary: parsed.today_main || '', at: Date.now() };
      cachedClusters = result;
      return result;
    } catch (e: unknown) {
      logger.error(`Clustering error: ${e instanceof Error ? e.message : String(e)}`);
      return { clusters: [], summary: 'Klasterlash vaqtincha ishlamayapti.', at: Date.now() };
    }
  },

  async sendClusterDigest(userId: number, channelId?: string) {
    const data = await this.getClusters(true);
    if (!data.clusters.length) return false;

    const user = await DBService.getUser(userId);
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
      await bot.sendMessage(target, msg, { parse_mode: 'HTML' });
      return true;
    } catch (e: unknown) {
      logger.error(`Cluster digest send failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  },
};
