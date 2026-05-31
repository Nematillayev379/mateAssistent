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

import { SchedulerService } from '../src/services/scheduler';

describe('SchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('setup initializes cron schedule', () => {
    SchedulerService.setup();
  });

  test('setup can only be called once', () => {
    SchedulerService.setup();
    SchedulerService.setup();
  });

  test('processScheduledPosts handles empty queue', async () => {
    const { DBService } = await import('../src/services/database');
    (DBService.getPendingScheduledPosts as jest.Mock).mockResolvedValue([]);
    
    await SchedulerService.processScheduledPosts();
    expect(DBService.getPendingScheduledPosts).toHaveBeenCalled();
  });

  test('processScheduledPosts skips posts without user', async () => {
    const { DBService } = await import('../src/services/database');
    (DBService.getPendingScheduledPosts as jest.Mock).mockResolvedValue([
      { id: 1, user_id: 999, type: 'text', content: '{}', scheduled_at: new Date().toISOString() }
    ]);
    (DBService.getUser as jest.Mock).mockResolvedValue(null);
    
    await SchedulerService.processScheduledPosts();
    expect(DBService.updateScheduledPostStatus).toHaveBeenCalledWith(1, 'failed');
  });

  test('processScheduledPosts skips posts without target channel', async () => {
    const { DBService } = await import('../src/services/database');
    (DBService.getPendingScheduledPosts as jest.Mock).mockResolvedValue([
      { id: 2, user_id: 123, type: 'text', content: '{}', scheduled_at: new Date().toISOString() }
    ]);
    (DBService.getUser as jest.Mock).mockResolvedValue({ telegram_id: 123, target_channel: null });
    
    await SchedulerService.processScheduledPosts();
    expect(DBService.updateScheduledPostStatus).toHaveBeenCalledWith(2, 'failed');
  });
});
