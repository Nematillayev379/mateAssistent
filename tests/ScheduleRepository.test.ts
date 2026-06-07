import { ScheduleRepository } from '../src/repositories/PricingRepository';

class MockChain {
  _data: any = null;
  _error: any = null;
  _count: any = undefined;

  select = jest.fn().mockImplementation(function (this: any) { return this; });
  eq = jest.fn().mockImplementation(function (this: any) { return this; });
  in = jest.fn().mockImplementation(function (this: any) { return this; });
  lte = jest.fn().mockImplementation(function (this: any) { return this; });
  order = jest.fn().mockImplementation(function (this: any) { return this; });
  limit = jest.fn().mockImplementation(function (this: any) { return this; });
  single = jest.fn().mockImplementation(function (this: any) { return this; });
  maybeSingle = jest.fn().mockImplementation(function (this: any) { return this; });
  insert = jest.fn().mockImplementation(function (this: any) { return this; });
  update = jest.fn().mockImplementation(function (this: any) { return this; });
  upsert = jest.fn().mockImplementation(function (this: any) { return this; });
  delete = jest.fn().mockImplementation(function (this: any) { return this; });
  rpc = jest.fn().mockImplementation(function (this: any) { return this; });

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    const result: { data: any; error: any; count?: number } = { data: this._data, error: this._error };
    if (this._count !== undefined) result.count = this._count;
    return Promise.resolve(result).then(resolve, reject);
  }
}

const chain = new MockChain();

jest.mock('../src/repositories/BaseRepository', () => ({
  getSupabase: jest.fn(() => ({
    from: jest.fn(() => chain),
    rpc: jest.fn(() => chain),
  })),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function mockResult(data: any, error: any = null, count?: number) {
  chain._data = data;
  chain._error = error;
  chain._count = count;
}

describe('ScheduleRepository', () => {
  beforeEach(() => {
    chain._data = null;
    chain._error = null;
    chain._count = undefined;
    chain.select.mockReset().mockReturnValue(chain);
    chain.eq.mockReset().mockReturnValue(chain);
    chain.in.mockReset().mockReturnValue(chain);
    chain.lte.mockReset().mockReturnValue(chain);
    chain.order.mockReset().mockReturnValue(chain);
    chain.limit.mockReset().mockReturnValue(chain);
    chain.single.mockReset().mockReturnValue(chain);
    chain.maybeSingle.mockReset().mockReturnValue(chain);
    chain.insert.mockReset().mockReturnValue(chain);
    chain.update.mockReset().mockReturnValue(chain);
    chain.upsert.mockReset().mockReturnValue(chain);
    chain.delete.mockReset().mockReturnValue(chain);
    chain.rpc.mockReset().mockReturnValue(chain);
  });

  describe('add', () => {
    it('inserts a valid scheduled post', async () => {
      mockResult(null, null);
      const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      await expect(
        ScheduleRepository.add(123, 'text', { text: 'Hello' }, future)
      ).resolves.not.toThrow();
      expect(chain.insert).toHaveBeenCalled();
    });

    it('throws on invalid type', async () => {
      await expect(
        ScheduleRepository.add(123, 'invalid' as 'text', { text: 'Hi' }, new Date().toISOString())
      ).rejects.toThrow('Invalid scheduled post type');
    });

    it('throws on invalid date', async () => {
      await expect(
        ScheduleRepository.add(123, 'text', { text: 'Hi' }, 'not-a-date')
      ).rejects.toThrow('Invalid scheduledAt');
    });

    it('throws on empty date', async () => {
      await expect(
        ScheduleRepository.add(123, 'text', { text: 'Hi' }, '')
      ).rejects.toThrow('Invalid scheduledAt');
    });

    it('accepts all valid types: video, audio, text', async () => {
      mockResult(null, null);
      const future = new Date(Date.now() + 3600 * 1000).toISOString();
      for (const t of ['video', 'audio', 'text'] as const) {
        await expect(
          ScheduleRepository.add(1, t, { url: 'u' }, future)
        ).resolves.not.toThrow();
      }
    });
  });

  describe('cancel', () => {
    it('updates status to cancelled for matching user+id', async () => {
      mockResult(null, null);
      await expect(ScheduleRepository.cancel(123, 5)).resolves.not.toThrow();
      expect(chain.update).toHaveBeenCalledWith({ status: 'cancelled' });
    });

    it('does not throw on db error', async () => {
      mockResult(null, { message: 'db error' });
      await expect(ScheduleRepository.cancel(123, 5)).resolves.not.toThrow();
    });
  });

  describe('getPending', () => {
    it('returns pending posts whose time has passed', async () => {
      const posts = [
        { id: 1, status: 'pending', scheduled_at: new Date().toISOString() },
        { id: 2, status: 'pending', scheduled_at: new Date().toISOString() }
      ];
      mockResult(posts);
      const result = await ScheduleRepository.getPending();
      expect(result).toHaveLength(2);
      expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    });

    it('returns empty array on db error', async () => {
      mockResult(null, { message: 'fail' });
      const result = await ScheduleRepository.getPending();
      expect(result).toEqual([]);
    });

    it('returns empty when no posts', async () => {
      mockResult([]);
      const result = await ScheduleRepository.getPending();
      expect(result).toEqual([]);
    });
  });

  describe('getByUser', () => {
    it('returns only pending and sent posts for user', async () => {
      const posts = [
        { id: 1, user_id: 123, status: 'pending' },
        { id: 2, user_id: 123, status: 'sent' }
      ];
      mockResult(posts);
      const result = await ScheduleRepository.getByUser(123);
      expect(result).toHaveLength(2);
      expect(chain.eq).toHaveBeenCalledWith('user_id', 123);
      expect(chain.in).toHaveBeenCalledWith('status', ['pending', 'sent']);
    });

    it('orders by scheduled_at descending', async () => {
      mockResult([]);
      await ScheduleRepository.getByUser(123);
      expect(chain.order).toHaveBeenCalledWith('scheduled_at', { ascending: false });
    });

    it('returns empty array on db error', async () => {
      mockResult(null, { message: 'fail' });
      const result = await ScheduleRepository.getByUser(123);
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns single post matching user+id', async () => {
      mockResult({ id: 7, user_id: 123, type: 'text' });
      const result = await ScheduleRepository.getById(123, 7);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(7);
    });

    it('returns null when not found', async () => {
      mockResult(null);
      const result = await ScheduleRepository.getById(123, 999);
      expect(result).toBeNull();
    });

    it('returns null on db error', async () => {
      mockResult(null, { message: 'fail' });
      const result = await ScheduleRepository.getById(123, 7);
      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    it('counts posts grouped by status', async () => {
      mockResult([
        { status: 'pending' },
        { status: 'pending' },
        { status: 'sent' },
        { status: 'failed' },
        { status: 'cancelled' }
      ]);
      const stats = await ScheduleRepository.getStats(123);
      expect(stats).toEqual({ pending: 2, sent: 1, failed: 1, cancelled: 1 });
    });

    it('returns all zeros when no data', async () => {
      mockResult([]);
      const stats = await ScheduleRepository.getStats(123);
      expect(stats).toEqual({ pending: 0, sent: 0, failed: 0, cancelled: 0 });
    });

    it('returns zeros on db error', async () => {
      mockResult(null, { message: 'fail' });
      const stats = await ScheduleRepository.getStats(123);
      expect(stats).toEqual({ pending: 0, sent: 0, failed: 0, cancelled: 0 });
    });

    it('ignores unknown status values', async () => {
      mockResult([
        { status: 'pending' },
        { status: 'weird-state' as 'pending' }
      ]);
      const stats = await ScheduleRepository.getStats(123);
      expect(stats.pending).toBe(1);
      expect(stats.sent).toBe(0);
    });
  });

  describe('markSent', () => {
    it('updates status to sent for given id', async () => {
      mockResult(null, null);
      await expect(ScheduleRepository.markSent(42)).resolves.not.toThrow();
      expect(chain.update).toHaveBeenCalledWith({ status: 'sent' });
      expect(chain.eq).toHaveBeenCalledWith('id', 42);
    });
  });

  describe('updateStatus', () => {
    it('updates status to given value', async () => {
      mockResult(null, null);
      await expect(ScheduleRepository.updateStatus(42, 'failed')).resolves.not.toThrow();
      expect(chain.update).toHaveBeenCalledWith({ status: 'failed' });
    });

    it('accepts any string status', async () => {
      mockResult(null, null);
      await expect(ScheduleRepository.updateStatus(42, 'cancelled')).resolves.not.toThrow();
      await expect(ScheduleRepository.updateStatus(42, 'sent')).resolves.not.toThrow();
    });
  });
});
