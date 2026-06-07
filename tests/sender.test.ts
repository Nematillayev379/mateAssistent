jest.mock('../src/services/bot_instance', () => ({
  bot: {
    sendMessage: jest.fn().mockResolvedValue({}),
    sendPhoto: jest.fn().mockResolvedValue({}),
    sendVideo: jest.fn().mockResolvedValue({}),
    sendAudio: jest.fn().mockResolvedValue({}),
    getMe: jest.fn().mockResolvedValue({ username: 'testbot' }),
  },
}));

jest.mock('../src/services/database', () => ({
  DBService: {
    getAllUserChannels: jest.fn().mockResolvedValue([]),
    incrementStat: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn().mockResolvedValue(null),
  }
}));

jest.mock('../src/services/scraper', () => ({
  ScraperService: {
    isMediaUrl: jest.fn().mockReturnValue(false),
  }
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { safeSend, buildChannelPostMarkup } from '../src/services/sender';

describe('Sender - buildChannelPostMarkup', () => {
  test('builds markup with title and content', async () => {
    const markup = await buildChannelPostMarkup({
      title: 'Test Title',
      content: 'Test content here',
    });
    expect(markup).toContain('Test Title');
    expect(markup).toContain('Test content here');
  });

  test('builds markup with source', async () => {
    const markup = await buildChannelPostMarkup({
      title: 'Title',
      content: 'Content',
      source: 'BBC News',
      url: 'https://bbc.com/news',
    });
    expect(markup).toContain('BBC News');
  });

  test('builds markup with URL', async () => {
    const markup = await buildChannelPostMarkup({
      title: 'Title',
      content: 'Content',
      url: 'https://example.com/article',
    });
    expect(markup).toContain('example.com');
  });

  test('escapes HTML in title', async () => {
    const markup = await buildChannelPostMarkup({
      title: '<script>alert("xss")</script>',
      content: 'Content',
    });
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
  });

  test('escapes HTML in content', async () => {
    const markup = await buildChannelPostMarkup({
      title: 'Title',
      content: '<img src=x onerror=alert(1)>',
    });
    expect(markup).not.toContain('<img');
  });

  test('truncates long content', async () => {
    const longContent = 'A'.repeat(5000);
    const markup = await buildChannelPostMarkup({
      title: 'Title',
      content: longContent,
    }, { maxLength: 1024 });
    expect(markup.length).toBeLessThanOrEqual(1024);
  });

  test('handles empty title gracefully', async () => {
    const markup = await buildChannelPostMarkup({
      title: '',
      content: 'Content',
    });
    expect(markup).toContain('Content');
  });

  test('handles empty content gracefully', async () => {
    const markup = await buildChannelPostMarkup({
      title: 'Title',
      content: '',
    });
    expect(markup).toContain('Title');
  });
});

describe('Sender - safeSend', () => {
  test('skips if no target channel', async () => {
    await safeSend({ telegram_id: 123, target_channel: null }, { title: 'Test' });
  });

  test('skips if article is missing', async () => {
    await safeSend({ telegram_id: 123, target_channel: '@test' }, null as unknown as { title?: string });
  });
});
