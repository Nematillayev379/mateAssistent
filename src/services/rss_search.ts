import { ScraperService } from './scraper';
import { getSmartAIResponse } from './ai';
import { DBService } from './database';
import { logger, sanitizeLogInput } from '../utils/logger';

interface SearchQuery {
  id: string;
  userId: number;
  topic: string;
  keywords: string[];
  maxResults: number;
  mode: 'instant' | 'daily';
  isActive: boolean;
  createdAt: number;
  lastRunAt?: number;
}

interface SearchResult {
  title: string;
  url: string;
  content: string;
  source: string;
  pubDate: string;
  relevanceScore: number;
}

const activeSearches = new Map<number, SearchQuery[]>();

function normalizeKeywords(keywords: string[] | undefined, topic: string): string[] {
  const cleaned = (Array.isArray(keywords) ? keywords : [])
    .map((kw) => String(kw || '').trim().toLowerCase())
    .filter(Boolean);

  if (cleaned.length > 0) {
    return [...new Set(cleaned)].slice(0, 10);
  }

  const fallback = String(topic || '').trim().toLowerCase();
  return fallback ? [fallback] : [];
}

function normalizeSearchRecord(search: any): SearchQuery | null {
  if (!search || typeof search !== 'object') return null;
  const id = String(search.id || '').trim();
  const topic = String(search.topic || '').trim();
  if (!id || !topic) return null;
  const mode = search.mode === 'daily' ? 'daily' : 'instant';
  const keywords = normalizeKeywords(search.keywords, topic);
  return {
    id,
    userId: Number(search.userId) || 0,
    topic,
    keywords,
    maxResults: Math.min(Math.max(Number(search.maxResults) || 10, 1), 50),
    mode,
    isActive: search.isActive !== false,
    createdAt: Number(search.createdAt) || Date.now(),
    lastRunAt: typeof search.lastRunAt === 'number' ? search.lastRunAt : undefined,
  };
}

export const RssSearchService = {
  async createSearch(
    userId: number,
    topic: string,
    keywords: string[],
    maxResults: number,
    mode: 'instant' | 'daily'
  ): Promise<SearchQuery> {
    const safeTopic = String(topic || '').trim();
    const search: SearchQuery = {
      id: `search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      topic: safeTopic,
      keywords: normalizeKeywords(keywords, safeTopic),
      maxResults: Math.min(Math.max(maxResults, 1), 50),
      mode: mode === 'daily' ? 'daily' : 'instant',
      isActive: true,
      createdAt: Date.now(),
    };

    const userSearches = activeSearches.get(userId) || [];
    userSearches.push(search);
    activeSearches.set(userId, userSearches);

    await DBService.updateUser(userId, {
      rss_searches: JSON.stringify(userSearches),
    });

    logger.info(`RSS Search created: ${search.id} for user ${userId} - "${topic}"`);
    return search;
  },

  async deleteSearch(userId: number, searchId: string): Promise<boolean> {
    const userSearches = activeSearches.get(userId) || [];
    const filtered = userSearches.filter(s => s.id !== searchId);
    activeSearches.set(userId, filtered);

    await DBService.updateUser(userId, {
      rss_searches: JSON.stringify(filtered),
    });

    return filtered.length < userSearches.length;
  },

  async getUserSearches(userId: number): Promise<SearchQuery[]> {
    if (!activeSearches.has(userId)) {
      const user = await DBService.getUser(userId);
      if (user?.rss_searches) {
        try {
          const searches = JSON.parse(user.rss_searches);
          const normalized = Array.isArray(searches)
            ? searches.map(normalizeSearchRecord).filter(Boolean) as SearchQuery[]
            : [];
          activeSearches.set(userId, normalized);
        } catch {
          activeSearches.set(userId, []);
        }
      } else {
        activeSearches.set(userId, []);
      }
    }
    return activeSearches.get(userId) || [];
  },

  async runSearch(searchId: string): Promise<SearchResult[]> {
    let search: SearchQuery | undefined;
    for (const [, searches] of activeSearches.entries()) {
      search = searches.find(s => s.id === searchId);
      if (search) break;
    }
    if (!search) return [];

    const user = await DBService.getUser(search.userId);
    if (!user) return [];

    const sources = await DBService.getUserSources(search.userId);
    if (!sources.length) return [];
    const keywords = normalizeKeywords(search.keywords, search.topic);

    const allResults: SearchResult[] = [];

    for (const source of sources.slice(0, 5)) {
      try {
        const articles = await ScraperService.fetchRSS(source.url);
        for (const article of articles.slice(0, 20)) {
          const text = `${article.title || ''} ${article.contentSnippet || article.content || ''}`.toLowerCase();
          const matchesKeyword = keywords.some(kw =>
            text.includes(kw.toLowerCase())
          );
          const matchesTopic = text.includes(search.topic.toLowerCase());

          if (matchesKeyword || matchesTopic) {
            const score = this.calculateRelevance(article, search);
            allResults.push({
              title: article.title || '',
              url: article.link || '',
              content: article.contentSnippet || article.content || '',
              source: source.name || source.url,
              pubDate: article.pubDate || '',
              relevanceScore: score,
            });
          }
        }
      } catch (err: any) {
        logger.warn(`RSS Search fetch error for ${source.name}: ${err.message}`);
      }
    }

    allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topResults = allResults.slice(0, search.maxResults);

    search.lastRunAt = Date.now();
    return topResults;
  },

  calculateRelevance(article: any, search: SearchQuery): number {
    let score = 0;
    const text = `${article.title || ''} ${article.contentSnippet || article.content || ''}`.toLowerCase();
    const keywords = normalizeKeywords(search.keywords, search.topic);

    if (text.includes(search.topic.toLowerCase())) score += 10;

    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) score += 5;
    }

    if (article.title?.toLowerCase().includes(search.topic.toLowerCase())) score += 3;

    const pubDate = new Date(article.pubDate || 0);
    const hoursAgo = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
    if (hoursAgo < 24) score += 5;
    else if (hoursAgo < 72) score += 3;
    else if (hoursAgo < 168) score += 1;

    return score;
  },

  async summarizeResults(results: SearchResult[], topic: string, lang: string): Promise<string> {
    if (results.length === 0) {
      return `"${topic}" bo'yicha natija topilmadi.`;
    }

    const resultsText = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.source} - ${r.pubDate}\n   ${r.content.slice(0, 200)}`
    ).join('\n\n');

    const langMap: Record<string, string> = { uz: "O'zbek", ru: "Russian", en: "English", tr: "Turkish", ky: "Kyrgyz", kk: "Kazakh" };
    const fullLang = langMap[lang] || lang;

    const systemPrompt = `Sen yangiliklar tahlilchisan. Quyidagi natijalarni ${fullLang} tilida qisqacha özetla. Mavzu: ${topic}. Faqat eng muhim xabarlarni tanla.`;
    const userPrompt = `Natijalar:\n${resultsText}`;

    try {
      const summary = await getSmartAIResponse(systemPrompt, userPrompt);
      return summary || this.formatResultsPlain(results, topic);
    } catch {
      return this.formatResultsPlain(results, topic);
    }
  },

  formatResultsPlain(results: SearchResult[], topic: string): string {
    let text = `🔍 <b>${topic}</b> (${results.length} ta natija)\n\n`;
    for (const r of results.slice(0, 5)) {
      text += `📰 <b>${r.title}</b>\n`;
      text += `🌐 ${r.source}\n`;
      if (r.url) text += `🔗 ${r.url}\n`;
      text += `\n`;
    }
    return text;
  },
};
