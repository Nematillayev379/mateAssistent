const mockGroqCreate = jest.fn();

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGroqCreate } }
  }))
}));

jest.mock('openai', () => ({
  __esModule: true,
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } }
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

process.env.GROQ_API_KEY = 'test-groq-key-1,test-groq-key-2,test-groq-key-3';
process.env.TELEGRAM_TOKEN = '123456:test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
process.env.PUBLIC_URL = 'http://localhost:3000';

import { getActiveKeyStats, refreshKeyPool } from '../src/services/ai';

describe('AI Key Rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroqCreate.mockReset();
  });

  test('getActiveKeyStats returns key counts by provider', () => {
    const stats = getActiveKeyStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('byProvider');
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.byProvider).toBe('object');
  });

  test('refreshKeyPool updates key pool from environment', async () => {
    await expect(refreshKeyPool()).resolves.not.toThrow();
  });

  test('key pool contains keys', () => {
    const stats = getActiveKeyStats();
    expect(stats.total).toBeGreaterThan(0);
  });

  test('key rotation across multiple requests', async () => {
    mockGroqCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Response 1' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Response 2' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Response 3' } }] });

    const { getSmartAIResponse } = await import('../src/services/ai');
    
    const r1 = await getSmartAIResponse('System', 'User 1');
    const r2 = await getSmartAIResponse('System', 'User 2');
    const r3 = await getSmartAIResponse('System', 'User 3');
    
    expect(r1).toBe('Response 1');
    expect(r2).toBe('Response 2');
    expect(r3).toBe('Response 3');
    expect(mockGroqCreate).toHaveBeenCalledTimes(3);
  });

  test('key pool handles API errors gracefully', async () => {
    mockGroqCreate.mockRejectedValue(new Error('Rate limit exceeded'));
    
    const { getSmartAIResponse } = await import('../src/services/ai');
    try {
      const result = await getSmartAIResponse('System', 'User');
      expect(typeof result).toBe('string');
    } catch (e: any) {
      expect(e.message).toContain('Rate limit');
    }
  });
});
