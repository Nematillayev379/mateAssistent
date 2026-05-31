jest.mock('../src/services/bot_instance', () => ({
  bot: {
    setMyCommands: jest.fn(),
    setWebHook: jest.fn(),
    deleteWebHook: jest.fn(),
    startPolling: jest.fn(() => Promise.resolve()),
    stopPolling: jest.fn(),
    isPolling: jest.fn(() => false),
    on: jest.fn(),
    getMe: jest.fn(),
    sendMessage: jest.fn(),
    sendVideo: jest.fn(),
    sendAudio: jest.fn(),
    sendPhoto: jest.fn(),
  },
  notify: jest.fn(),
}));

jest.mock('../src/commands', () => ({
  registerCommands: jest.fn(),
}));

jest.mock('../src/services/database', () => ({
  DBService: {
    getUserOutputChannels: jest.fn(() => []),
    incrementStat: jest.fn(),
  },
}));

jest.mock('../src/services/scraper', () => ({
  ScraperService: {
    isMediaUrl: jest.fn(() => false),
  },
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { bot } from '../src/services/bot_instance';
import { __testing } from '../src/services/telegram';

describe('telegram polling recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __testing.resetPollingState();
  });

  it('marks EACCES polling errors as fatal', () => {
    expect(__testing.isFatalPollingError('connect EACCES 149.154.166.110:443')).toBe(true);
  });

  it('stops polling immediately for fatal errors', () => {
    __testing.handlePollingError(new Error('connect EACCES 149.154.166.110:443'));
    expect(bot.stopPolling).toHaveBeenCalledTimes(1);
    expect(bot.startPolling).not.toHaveBeenCalled();
  });

  it('backs off polling restarts as attempts increase', () => {
    expect(__testing.getPollingRestartDelay(1)).toBe(5000);
    expect(__testing.getPollingRestartDelay(3)).toBe(15000);
    expect(__testing.getPollingRestartDelay(10)).toBe(30000);
  });
});
