const mockGroqCreate = jest.fn();
const mockOpenaiCreate = jest.fn();

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGroqCreate } }
  }))
}));

jest.mock('openai', () => ({
  __esModule: true,
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenaiCreate } }
  }))
}));

jest.mock('../src/services/database', () => ({
  DBService: {
    getValidApiKeys: jest.fn().mockResolvedValue([]),
    getLastTitles: jest.fn().mockResolvedValue([]),
    findSimilarNews: jest.fn().mockResolvedValue(null),
    saveEmbedding: jest.fn().mockResolvedValue(undefined),
  }
}));

process.env.GROQ_API_KEY = 'test-groq-key-mock';
process.env.TELEGRAM_TOKEN = '123456:test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
process.env.PUBLIC_URL = 'http://localhost:3000';

let moderateContent: any, categorizeNews: any, translateToUzbek: any;
let analyzeSentiment: any, getNiceEmoji: any, getActiveKeyStats: any;

function reloadModule() {
  jest.resetModules();
  const ai = require('../src/services/ai');
  moderateContent = ai.moderateContent;
  categorizeNews = ai.categorizeNews;
  translateToUzbek = ai.translateToUzbek;
  analyzeSentiment = ai.analyzeSentiment;
  getNiceEmoji = ai.getNiceEmoji;
  getActiveKeyStats = ai.getActiveKeyStats;
}

describe('ai.ts', () => {
  beforeEach(() => {
    mockGroqCreate.mockReset();
    mockGroqCreate.mockResolvedValue({
      choices: [{ message: { content: '' } }]
    });
    reloadModule();
  });

  describe('moderateContent', () => {
    it('returns SAFE when AI responds SAFE', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'SAFE' } }]
      });
      const result = await moderateContent('Test title', 'Test content');
      expect(result).toEqual({ status: 'SAFE' });
    });

    it('returns BLOCKED when AI flags content', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "BLOCKED: Terrorizm targ'iboti" } }]
      });
      const result = await moderateContent('Bad title', 'Bad content');
      expect(result).toEqual({ status: 'BLOCKED', reason: "Terrorizm targ'iboti" });
    });

    it('handles AI returning extra whitespace around SAFE', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '  SAFE  ' } }]
      });
      const result = await moderateContent('Title', 'Content');
      expect(result).toEqual({ status: 'SAFE' });
    });

    it('returns BLOCKED with reason when moderation service errors', async () => {
      mockGroqCreate.mockRejectedValueOnce(new Error('API error'));
      const result = await moderateContent('Title', 'Content');
      expect(result).toEqual({ status: 'BLOCKED', reason: 'Moderation service unavailable' });
    });
  });

  describe('categorizeNews', () => {
    it('returns a valid category from AI response', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Sport' } }]
      });
      const result = await categorizeNews('Football match', 'Match details...');
      expect(result).toBe('Sport');
    });

    it('returns Boshqa for unknown category', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'UnknownCategory' } }]
      });
      const result = await categorizeNews('Test', 'Test');
      expect(result).toBe('Boshqa');
    });

    it('returns general on API error', async () => {
      mockGroqCreate.mockRejectedValueOnce(new Error('fail'));
      const result = await categorizeNews('Test', 'Test');
      expect(result).toBe('general');
    });
  });

  describe('analyzeSentiment', () => {
    it('returns positive for positive content', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'positive' } }]
      });
      const result = await analyzeSentiment('Good news!');
      expect(result).toBe('positive');
    });

    it('returns negative for negative content', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'negative' } }]
      });
      const result = await analyzeSentiment('Bad news...');
      expect(result).toBe('negative');
    });

    it('returns neutral when AI response unclear', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'This is a news headline' } }]
      });
      const result = await analyzeSentiment('Normal news');
      expect(result).toBe('neutral');
    });

    it('returns neutral on error', async () => {
      mockGroqCreate.mockRejectedValueOnce(new Error('fail'));
      const result = await analyzeSentiment('News');
      expect(result).toBe('neutral');
    });
  });

  describe('getNiceEmoji', () => {
    it('extracts emoji from AI response', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '\u{1F4F0}' } }]
      });
      const result = await getNiceEmoji('News title');
      expect(result).toBe('\u{1F4F0}');
    });

    it('returns fallback emoji when AI returns no emoji', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'No emoji here' } }]
      });
      const result = await getNiceEmoji('News');
      expect(result).toBe('\uD83D\uDD39');
    });
  });

  describe('translateToUzbek', () => {
    it('parses JSON response from AI', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"title": "Yangilik sarlavhasi", "content": "Yangilik matni"}' } }]
      });
      const result = await translateToUzbek('News title', 'News content');
      expect(result).toEqual({ title: 'Yangilik sarlavhasi', content: 'Yangilik matni' });
    });

    it('falls back to original content on parse failure', async () => {
      mockGroqCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Invalid response without JSON' } }]
      });
      const result = await translateToUzbek('Original title', 'Original content');
      expect(result).toEqual({ title: 'Original title', content: 'Original content' });
    });

    it('falls back on API error', async () => {
      mockGroqCreate.mockRejectedValueOnce(new Error('fail'));
      const result = await translateToUzbek('Fallback title', 'Fallback content');
      expect(result).toEqual({ title: 'Fallback title', content: 'Fallback content' });
    });
  });

  describe('getActiveKeyStats', () => {
    it('returns key stats structure', () => {
      const stats = getActiveKeyStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byProvider');
      expect(typeof stats.total).toBe('number');
    });
  });
});
