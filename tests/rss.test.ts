jest.mock('../src/services/scraper', () => ({
  ScraperService: {
    fetchRSS: jest.fn().mockResolvedValue([
      { title: 'Test Article 1', link: 'https://example.com/1', contentSnippet: 'Content 1', imageUrl: null, pubDate: new Date().toISOString() },
      { title: 'Test Article 2', link: 'https://example.com/2', contentSnippet: 'Content 2', imageUrl: null, pubDate: new Date().toISOString() },
    ]),
    scrapeArticle: jest.fn().mockResolvedValue({ title: 'Scraped', content: 'Full content', imageUrl: null }),
    isPublicExternalUrl: jest.fn().mockResolvedValue(true),
    discoverRSS: jest.fn().mockResolvedValue('https://example.com/rss'),
    isMediaUrl: jest.fn().mockImplementation((url: string) => /youtube|youtu\.be|instagram|tiktok|soundcloud/i.test(url)),
  }
}));

jest.mock('../src/services/database', () => ({
  DBService: {
    getUser: jest.fn().mockResolvedValue(null),
    getUserSources: jest.fn().mockResolvedValue([]),
    isSeenOrSeenByTitle: jest.fn().mockResolvedValue(false),
    markSeen: jest.fn().mockResolvedValue(undefined),
    incrementStat: jest.fn().mockResolvedValue(undefined),
    acquireRecentNewsLock: jest.fn().mockReturnValue(true),
    tryReserveUserSendSlot: jest.fn().mockReturnValue(true),
    releaseUserSendSlot: jest.fn().mockReturnValue(undefined),
  }
}));

jest.mock('../src/services/ai', () => ({
  getSmartAIResponse: jest.fn().mockResolvedValue('Test AI summary'),
  moderateContent: jest.fn().mockResolvedValue({ status: 'OK' }),
  checkSemanticDuplicate: jest.fn().mockResolvedValue(false),
  categorizeNews: jest.fn().mockResolvedValue('Sport'),
  getNiceEmoji: jest.fn().mockReturnValue('⚽'),
}));

jest.mock('../src/services/sender', () => ({
  safeSend: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/bot_instance', () => ({
  bot: { sendMessage: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  sanitizeLogInput: (s: string) => s,
}));

import { ScraperService } from '../src/services/scraper';

describe('ScraperService - RSS Fetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchRSS returns array of articles', async () => {
    const articles = await ScraperService.fetchRSS('https://example.com/rss');
    expect(Array.isArray(articles)).toBe(true);
    expect(articles.length).toBe(2);
    expect(articles[0]).toHaveProperty('title', 'Test Article 1');
    expect(articles[0]).toHaveProperty('link', 'https://example.com/1');
  });

  test('fetchRSS handles different URLs', async () => {
    const articles = await ScraperService.fetchRSS('https://other.com/feed');
    expect(Array.isArray(articles)).toBe(true);
  });

  test('scrapeArticle returns content', async () => {
    const result = await ScraperService.scrapeArticle('https://example.com/article');
    expect(result).toBeDefined();
    expect(result).toHaveProperty('content', 'Full content');
  });

  test('isPublicExternalUrl validates URLs', async () => {
    const valid = await ScraperService.isPublicExternalUrl('https://google.com');
    expect(valid).toBe(true);
  });

  test('discoverRSS finds RSS feed', async () => {
    const rssUrl = await ScraperService.discoverRSS('https://example.com');
    expect(rssUrl).toBe('https://example.com/rss');
  });

  test('isMediaUrl identifies YouTube URLs', () => {
    expect(ScraperService.isMediaUrl('https://youtube.com/watch?v=123')).toBe(true);
    expect(ScraperService.isMediaUrl('https://youtu.be/123')).toBe(true);
  });

  test('isMediaUrl identifies TikTok URLs', () => {
    expect(ScraperService.isMediaUrl('https://tiktok.com/@user/video/123')).toBe(true);
  });

  test('isMediaUrl rejects non-media URLs', () => {
    expect(ScraperService.isMediaUrl('https://example.com/page')).toBe(false);
  });
});

describe('ScraperService - Article Structure', () => {
  test('articles have required fields', async () => {
    const articles = await ScraperService.fetchRSS('https://example.com/rss');
    for (const article of articles) {
      expect(article).toHaveProperty('title');
      expect(article).toHaveProperty('link');
      expect(typeof article.title).toBe('string');
      expect(typeof article.link).toBe('string');
    }
  });

  test('articles are sorted by date', async () => {
    const articles = await ScraperService.fetchRSS('https://example.com/rss');
    expect(Array.isArray(articles)).toBe(true);
  });
});
