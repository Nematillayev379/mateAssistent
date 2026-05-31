const mockGetUser = jest.fn();
const mockAcquireRecentNewsLock = jest.fn();
const mockSafeSend = jest.fn();

jest.mock('../src/services/database', () => ({
  DBService: {
    get getUser() { return mockGetUser; },
    isSeenOrSeenByTitle: jest.fn().mockResolvedValue(false),
    markSeen: jest.fn(),
    get acquireRecentNewsLock() { return mockAcquireRecentNewsLock; },
    tryReserveUserSendSlot: jest.fn().mockReturnValue(true),
    releaseUserSendSlot: jest.fn(),
    incrementStat: jest.fn(),
  }
}));

jest.mock('../src/services/ai', () => ({
  getSmartAIResponse: jest.fn().mockResolvedValue('Test summary text here'),
  moderateContent: jest.fn().mockResolvedValue({ status: 'OK' }),
  checkSemanticDuplicate: jest.fn().mockResolvedValue(false),
  categorizeNews: jest.fn().mockResolvedValue('Sport'),
  getNiceEmoji: jest.fn().mockReturnValue('⚽'),
}));

jest.mock('../src/services/sender', () => ({
  get safeSend() { return mockSafeSend; },
  buildChannelPostMarkup: jest.fn().mockResolvedValue('Test markup'),
}));

jest.mock('../src/services/bot_instance', () => ({
  bot: { sendMessage: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../src/services/scraper', () => ({
  ScraperService: {
    fetchRSS: jest.fn().mockResolvedValue([]),
    scrapeArticle: jest.fn().mockResolvedValue(null),
    isMediaUrl: jest.fn().mockReturnValue(false),
  }
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  sanitizeLogInput: (s: string) => s,
}));

import { processArticleInline } from '../src/jobs/scraper_worker';

const user123 = {
  telegram_id: 123,
  target_channel: '@test_channel',
  is_active: 1,
  language: 'uz',
  interval_minutes: 15,
};

describe('processArticleInline - User Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeSend.mockResolvedValue(undefined);
  });

  test('skips if user has no target channel', async () => {
    mockGetUser.mockResolvedValue({ ...user123, target_channel: null });
    await processArticleInline(123, { title: 'Test', url: 'https://test.com' }, 'uz');
    expect(mockAcquireRecentNewsLock).not.toHaveBeenCalled();
  });

  test('skips if user is inactive', async () => {
    mockGetUser.mockResolvedValue({ ...user123, is_active: 0 });
    await processArticleInline(123, { title: 'Test', url: 'https://test.com' }, 'uz');
    expect(mockAcquireRecentNewsLock).not.toHaveBeenCalled();
  });

  test('skips if user not found', async () => {
    mockGetUser.mockResolvedValue(null);
    await processArticleInline(123, { title: 'Test', url: 'https://test.com' }, 'uz');
    expect(mockAcquireRecentNewsLock).not.toHaveBeenCalled();
  });
});

describe('processArticleInline - Lock & Dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(user123);
    mockSafeSend.mockResolvedValue(undefined);
  });

  test('skips if recent news lock fails', async () => {
    mockAcquireRecentNewsLock.mockReturnValue(false);
    await processArticleInline(123, { title: 'Locked', url: 'https://locked.com' }, 'uz');
    expect(mockSafeSend).not.toHaveBeenCalled();
  });

  test('processes article when lock acquired', async () => {
    mockAcquireRecentNewsLock.mockReturnValue(true);
    await processArticleInline(123, {
      title: 'New Article',
      url: 'https://new.com',
      content: 'Enough content for processing to work correctly'
    }, 'uz');
    expect(mockAcquireRecentNewsLock).toHaveBeenCalledWith(123, 'https://new.com', 'New Article');
  });
});

describe('processArticleInline - Content Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(user123);
    mockAcquireRecentNewsLock.mockReturnValue(true);
    mockSafeSend.mockResolvedValue(undefined);
  });

  test('sends article with summary', async () => {
    await processArticleInline(123, {
      title: 'Test Title',
      url: 'https://test.com',
      content: 'Some article content for testing'
    }, 'uz');
    expect(mockSafeSend).toHaveBeenCalled();
    const callArgs = mockSafeSend.mock.calls[0];
    expect(callArgs[1].title).toBe('Test Title');
    expect(callArgs[1].content).toBe('Test summary text here');
  });

  test('article gets category and emoji', async () => {
    await processArticleInline(123, {
      title: 'Sports News',
      url: 'https://sports.com',
      content: 'Football match results today'
    }, 'uz');
    expect(mockSafeSend).toHaveBeenCalled();
    const callArgs = mockSafeSend.mock.calls[0];
    expect(callArgs[1].category).toBe('Sport');
    expect(callArgs[1].emoji).toBe('⚽');
  });
});
