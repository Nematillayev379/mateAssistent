jest.mock('../src/services/database', () => ({
  DBService: {
    getUser: jest.fn().mockResolvedValue({ telegram_id: 1, language: 'uz', target_channel: '@test' }),
    getUserScheduledPosts: jest.fn().mockResolvedValue([]),
    addScheduledPost: jest.fn().mockResolvedValue(undefined),
    cancelScheduledPost: jest.fn().mockResolvedValue(undefined),
    checkUserLimit: jest.fn().mockResolvedValue(true),
  }
}));

jest.mock('../src/services/i18n', () => ({
  i18n: {
    t: (key: string, opts?: { lng?: string }) => {
      const map: Record<string, string> = {
        bot_schedule_command_title: 'Scheduled Posts',
        bot_schedule_command_help: '/schedule HH:MM text',
        bot_schedule_list_empty: '📅 Scheduled posts are empty',
        bot_schedule_list_header: '📅 Your scheduled posts:',
        bot_schedule_cancelled: '✅ Cancelled',
        bot_schedule_saved_manual: '✅ Saved: {time}',
        bot_schedule_btn_view: 'View',
        bot_schedule_btn_cancel: 'Cancel',
        bot_schedule_btn_refresh: 'Refresh',
        bot_schedule_btn_list: 'List',
        bot_schedule_view_title: 'Post Details',
        bot_schedule_view_empty_content: '(empty)',
        bot_schedule_view_field_id: 'ID',
        bot_schedule_view_field_type: 'Type',
        bot_schedule_view_field_time: 'Time',
        bot_schedule_view_field_status: 'Status',
        bot_schedule_view_field_content: 'Content',
        bot_invalid_time: 'Invalid time format',
        server_error: 'Server error',
        invalid_format: 'Invalid format',
        scheduled_post: 'Scheduled post',
        scheduling_limit_reached: 'Scheduling limit reached',
        too_many_requests: 'Too many requests',
      };
      return map[key] || key;
    }
  }
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { scheduleCommand, renderScheduleList, renderScheduleView, buildScheduleListKeyboard } from '../src/commands/schedule';

function makeMsg(text: string, userId = 1) {
  return { chat: { id: userId }, from: { id: userId }, message_id: 1, text } as any;
}

function makeMatch(text: string) {
  return scheduleCommand.pattern.exec(text) as RegExpExecArray | null;
}

describe('scheduleCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('pattern matches /schedule', () => {
    const match = makeMatch('/schedule');
    expect(match).not.toBeNull();
  });

  test('pattern matches /schedule list', () => {
    const match = makeMatch('/schedule list');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('list');
  });

  test('pattern matches /schedule 18:30 hello', () => {
    const match = makeMatch('/schedule 18:30 hello world');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('18:30 hello world');
  });

  test('pattern matches /schedule cancel 5', () => {
    const match = makeMatch('/schedule cancel 5');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('cancel 5');
  });

  test('help text when no args', async () => {
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule'));
    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining('Scheduled Posts'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );
  });

  test('/schedule list sends posts', async () => {
    const { DBService } = await import('../src/services/database');
    (DBService.getUserScheduledPosts as jest.Mock).mockResolvedValue([
      { id: 1, user_id: 1, type: 'text', content: { text: 'Hi' }, scheduled_at: '2099-01-01T12:00:00Z', status: 'pending' },
    ]);
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule list');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule list'));
    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining('scheduled posts'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );
  });

  test('/schedule list empty shows empty message', async () => {
    const { DBService } = await import('../src/services/database');
    (DBService.getUserScheduledPosts as jest.Mock).mockResolvedValue([]);
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule list');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule list'));
    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining('empty'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );
  });

  test('/schedule 18:30 creates text post', async () => {
    const { DBService } = await import('../src/services/database');
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule 18:30 My test post');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule 18:30 My test post'));
    expect(DBService.addScheduledPost).toHaveBeenCalledWith(
      1,
      'text',
      expect.objectContaining({ text: 'My test post' }),
      expect.any(String)
    );
  });

  test('/schedule 18:30 without text uses default content', async () => {
    const { DBService } = await import('../src/services/database');
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule 18:30');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule 18:30'));
    expect(DBService.addScheduledPost).toHaveBeenCalledWith(
      1,
      'text',
      expect.objectContaining({ text: expect.any(String) }),
      expect.any(String)
    );
  });

  test('/schedule cancel 5 cancels post', async () => {
    const { DBService } = await import('../src/services/database');
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule cancel 5');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule cancel 5'));
    expect(DBService.cancelScheduledPost).toHaveBeenCalledWith(1, 5);
    expect(bot.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining('Cancel'));
  });

  test('/schedule cancel with non-numeric id shows help', async () => {
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule cancel abc');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule cancel abc'));
    // "cancel abc" doesn't match cancel\s+(\d+) regex, falls through to help
    expect(bot.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringContaining('Scheduled Posts'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );
  });

  test('/schedule with invalid time returns error', async () => {
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule 99:99');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule 99:99'));
    expect(bot.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining('Invalid time'));
  });

  test('/schedule respects user limit', async () => {
    const { DBService } = await import('../src/services/database');
    (DBService.checkUserLimit as jest.Mock).mockResolvedValue(false);
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) } as any;
    const msg = makeMsg('/schedule 18:30 test');
    await scheduleCommand.handler(bot, msg, makeMatch('/schedule 18:30 test'));
    expect(bot.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining('limit'));
    expect(DBService.addScheduledPost).not.toHaveBeenCalled();
  });
});

describe('renderScheduleList', () => {
  test('empty posts returns empty message', () => {
    const result = renderScheduleList([], 'uz');
    expect(result.text).toContain('empty');
    expect(result.keyboard).toBeDefined();
  });

  test('pending posts renders list with emojis', () => {
    const posts = [
      { id: 1, type: 'text', content: { text: 'Hello' }, scheduled_at: '2099-01-01T10:00:00Z', status: 'pending' },
      { id: 2, type: 'video', content: { url: 'https://x.com/v.mp4' }, scheduled_at: '2099-01-02T12:00:00Z', status: 'pending' },
    ];
    const result = renderScheduleList(posts as any, 'uz');
    expect(result.text).toContain('📝');
    expect(result.text).toContain('📹');
    expect(result.text).toContain('#1');
    expect(result.text).toContain('#2');
    expect(result.keyboard.length).toBe(3); // 2 posts + refresh
  });

  test('limits to 15 items', () => {
    const posts = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, type: 'text', content: {}, scheduled_at: '2099-01-01T10:00:00Z', status: 'pending'
    }));
    const result = renderScheduleList(posts as any, 'uz');
    expect(result.text).toContain('+5');
  });
});

describe('renderScheduleView', () => {
  test('renders post details', () => {
    const post = {
      id: 42, type: 'audio', status: 'pending',
      content: { text: 'Song text' },
      scheduled_at: '2099-01-01T10:00:00Z'
    };
    const result = renderScheduleView(post as any, 'uz');
    expect(result.text).toContain('#42');
    expect(result.text).toContain('audio');
    expect(result.keyboard.length).toBe(2); // cancel + list
  });

  test('renders empty content fallback', () => {
    const post = { id: 1, type: 'text', status: 'pending', content: null, scheduled_at: '2099-01-01T10:00:00Z' };
    const result = renderScheduleView(post as any, 'uz');
    expect(result.text).toContain('empty');
  });
});

describe('buildScheduleListKeyboard', () => {
  test('builds correct keyboard rows', () => {
    const posts = [{ id: 1 }, { id: 2 }];
    const kb = buildScheduleListKeyboard(posts, 'uz');
    expect(kb.length).toBe(3); // 2 items + refresh
    expect(kb[0][0].callback_data).toBe('sched_view_1');
    expect(kb[0][1].callback_data).toBe('sched_cancel_1');
    expect(kb[2][0].callback_data).toBe('sched_list');
  });
});
