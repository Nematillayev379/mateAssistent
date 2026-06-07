jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../src/services/database', () => ({
  DBService: {
    getPendingScheduledPosts: jest.fn().mockResolvedValue([]),
    getUser: jest.fn().mockResolvedValue(null),
    updateScheduledPostStatus: jest.fn().mockResolvedValue(undefined),
    markScheduledPostSent: jest.fn().mockResolvedValue(undefined),
  }
}));

jest.mock('../src/services/bot_instance', () => ({
  bot: { sendMessage: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../src/services/sender', () => ({
  safeSend: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../src/config/config', () => ({
  CONFIG: { TIMEZONE: 'Asia/Tashkent' },
}));

import cron from 'node-cron';
import { SchedulerService } from '../src/services/scheduler';
import { DBService } from '../src/services/database';
import { logger } from '../src/utils/logger';
import { CONFIG } from '../src/config/config';

const mockGetPending = DBService.getPendingScheduledPosts as jest.Mock;
const mockGetUser = DBService.getUser as jest.Mock;
const mockUpdateStatus = DBService.updateScheduledPostStatus as jest.Mock;
const mockMarkSent = DBService.markScheduledPostSent as jest.Mock;

describe('SchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPending.mockResolvedValue([]);
    mockGetUser.mockResolvedValue(null);
    mockUpdateStatus.mockResolvedValue(undefined);
    mockMarkSent.mockResolvedValue(undefined);
  });

  test('setup initializes cron schedule', () => {
    SchedulerService.setup();
  });

  test('setup can only be called once', () => {
    SchedulerService.setup();
    SchedulerService.setup();
  });

  test('setup configures cron with correct expression and timezone', () => {
    jest.resetModules();
    jest.mock('node-cron', () => ({ schedule: jest.fn() }));
    const cronFresh = require('node-cron');
    const fresh = require('../src/services/scheduler').SchedulerService;
    fresh.setup();
    expect(cronFresh.schedule).toHaveBeenCalledWith(
      '* * * * *',
      expect.any(Function),
      { timezone: CONFIG.TIMEZONE }
    );
  });

  test('setup uses Asia/Tashkent timezone from config', () => {
    jest.resetModules();
    jest.mock('node-cron', () => ({ schedule: jest.fn() }));
    const cronFresh = require('node-cron');
    const fresh = require('../src/services/scheduler').SchedulerService;
    fresh.setup();
    const options = cronFresh.schedule.mock.calls[0][2] as { timezone: string };
    expect(options.timezone).toBe('Asia/Tashkent');
  });

  test('setup registers exactly one cron job per process', () => {
    jest.resetModules();
    jest.mock('node-cron', () => ({ schedule: jest.fn() }));
    const cronFresh = require('node-cron');
    const fresh = require('../src/services/scheduler').SchedulerService;
    fresh.setup();
    fresh.setup();
    fresh.setup();
    expect(cronFresh.schedule).toHaveBeenCalledTimes(1);
  });

  test('processScheduledPosts handles empty queue', async () => {
    mockGetPending.mockResolvedValue([]);
    await SchedulerService.processScheduledPosts();
    expect(mockGetPending).toHaveBeenCalled();
  });

  test('processScheduledPosts skips posts without user', async () => {
    mockGetPending.mockResolvedValue([
      { id: 1, user_id: 999, type: 'text', content: '{}', scheduled_at: new Date().toISOString() }
    ]);
    mockGetUser.mockResolvedValue(null);
    await SchedulerService.processScheduledPosts();
    expect(mockUpdateStatus).toHaveBeenCalledWith(1, 'failed');
  });

  test('processScheduledPosts skips posts without target channel', async () => {
    mockGetPending.mockResolvedValue([
      { id: 2, user_id: 123, type: 'text', content: '{}', scheduled_at: new Date().toISOString() }
    ]);
    mockGetUser.mockResolvedValue({ telegram_id: 123, target_channel: null });
    await SchedulerService.processScheduledPosts();
    expect(mockUpdateStatus).toHaveBeenCalledWith(2, 'failed');
  });

  test('processScheduledPosts processes multiple posts in sequence', async () => {
    mockGetPending.mockResolvedValue([
      { id: 10, user_id: 100, type: 'text', content: '{}', scheduled_at: new Date().toISOString() },
      { id: 11, user_id: 100, type: 'video', content: '{}', scheduled_at: new Date().toISOString() },
    ]);
    mockGetUser.mockResolvedValue({ telegram_id: 100, target_channel: '@ch' });

    await SchedulerService.processScheduledPosts();

    expect(mockGetUser).toHaveBeenCalledTimes(2);
    expect(mockGetUser).toHaveBeenCalledWith(100);
  });

  test('processScheduledPosts continues after individual post failure', async () => {
    mockGetPending.mockResolvedValue([
      { id: 20, user_id: 100, type: 'text', content: '{}', scheduled_at: new Date().toISOString() },
      { id: 21, user_id: 200, type: 'text', content: '{}', scheduled_at: new Date().toISOString() }
    ]);
    mockGetUser.mockImplementation((uid: number) => Promise.resolve({ telegram_id: uid, target_channel: '@c' }));
    mockGetUser.mockRejectedValueOnce(new Error('db fail')).mockResolvedValueOnce({ telegram_id: 200, target_channel: '@c' });

    await SchedulerService.processScheduledPosts();

    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  test('processScheduledPosts parses JSON content correctly', async () => {
    const content = { text: 'rich text', url: 'https://example.com', title: 'Title' };
    mockGetPending.mockResolvedValue([
      { id: 30, user_id: 123, type: 'text', content: JSON.stringify(content), scheduled_at: new Date().toISOString() }
    ]);
    mockGetUser.mockResolvedValue({ telegram_id: 123, target_channel: '@ch' });

    await SchedulerService.processScheduledPosts();

    expect(mockGetUser).toHaveBeenCalledWith(123);
  });

  test('processScheduledPosts falls back when content is plain string', async () => {
    mockGetPending.mockResolvedValue([
      { id: 31, user_id: 123, type: 'text', content: 'plain text only', scheduled_at: new Date().toISOString() }
    ]);
    mockGetUser.mockResolvedValue({ telegram_id: 123, target_channel: '@ch' });

    await SchedulerService.processScheduledPosts();

    expect(mockGetUser).toHaveBeenCalledWith(123);
  });

  test('processScheduledPosts keeps processing even if status update fails', async () => {
    mockGetPending.mockResolvedValue([
      { id: 40, user_id: 999, type: 'text', content: '{}', scheduled_at: new Date().toISOString() }
    ]);
    mockGetUser.mockResolvedValue(null);
    mockUpdateStatus.mockRejectedValue(new Error('db error'));

    await SchedulerService.processScheduledPosts();

    expect(mockUpdateStatus).toHaveBeenCalledWith(40, 'failed');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('setup cron callback invokes processScheduledPosts', async () => {
    jest.resetModules();
    jest.mock('node-cron', () => ({ schedule: jest.fn() }));
    jest.mock('../src/services/database', () => ({
      DBService: {
        getPendingScheduledPosts: jest.fn().mockResolvedValue([]),
        getUser: jest.fn().mockResolvedValue(null),
        updateScheduledPostStatus: jest.fn().mockResolvedValue(undefined),
        markScheduledPostSent: jest.fn().mockResolvedValue(undefined),
      }
    }));
    jest.mock('../src/utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
    jest.mock('../src/config/config', () => ({ CONFIG: { TIMEZONE: 'Asia/Tashkent' } }));
    jest.mock('../src/services/bot_instance', () => ({ bot: {} }));
    jest.mock('../src/services/sender', () => ({ safeSend: jest.fn() }));
    const cronFresh = require('node-cron');
    const freshScheduler = require('../src/services/scheduler').SchedulerService;
    const freshDB = require('../src/services/database').DBService;
    freshScheduler.setup();
    const callback = cronFresh.schedule.mock.calls[0][1] as () => Promise<void>;

    await callback();

    expect(freshDB.getPendingScheduledPosts).toHaveBeenCalled();
  });

  test('setup cron callback swallows errors and logs them', async () => {
    jest.resetModules();
    jest.mock('node-cron', () => ({ schedule: jest.fn() }));
    jest.mock('../src/services/database', () => ({
      DBService: {
        getPendingScheduledPosts: jest.fn().mockRejectedValue(new Error('boom')),
        getUser: jest.fn().mockResolvedValue(null),
        updateScheduledPostStatus: jest.fn().mockResolvedValue(undefined),
        markScheduledPostSent: jest.fn().mockResolvedValue(undefined),
      }
    }));
    jest.mock('../src/utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
    jest.mock('../src/config/config', () => ({ CONFIG: { TIMEZONE: 'Asia/Tashkent' } }));
    jest.mock('../src/services/bot_instance', () => ({ bot: {} }));
    jest.mock('../src/services/sender', () => ({ safeSend: jest.fn() }));
    const cronFresh = require('node-cron');
    const freshScheduler = require('../src/services/scheduler').SchedulerService;
    const freshLogger = require('../src/utils/logger').logger;
    freshScheduler.setup();
    const callback = cronFresh.schedule.mock.calls[0][1] as () => Promise<void>;

    await callback();

    expect(freshLogger.error).toHaveBeenCalledWith(expect.stringContaining('Scheduler loop failed'));
  });
});
