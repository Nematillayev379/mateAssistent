import { getSupabase, isLikelyDuplicate } from '../src/repositories/BaseRepository';

class MockChain {
  _data: any = null;
  _error: any = null;
  _count: any = undefined;

  select = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  eq = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  or = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  not = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  order = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  limit = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  single = jest.fn().mockImplementation(function (this: any) { return this; });
  maybeSingle = jest.fn().mockImplementation(function (this: any) { return this; });
  insert = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  upsert = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  update = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  delete = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });
  rpc = jest.fn().mockImplementation(function (this: any, ...args: any[]) { return this; });

  _then?: (resolve: Function) => void;

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    const result = { data: this._data, error: this._error };
    if (this._count !== undefined) (result as any).count = this._count;
    return Promise.resolve(result).then(resolve, reject);
  }
}

const chain = new MockChain();

jest.mock('../src/repositories/BaseRepository', () => ({
  getSupabase: jest.fn(() => ({
    from: jest.fn(() => chain),
    rpc: jest.fn(() => chain),
  })),
  normalizeUrl: jest.fn((u: string) => u),
  normalizeTitle: jest.fn((t: string) => t.toLowerCase()),
  isLikelyDuplicate: jest.fn((a: string, b: string) => a === b),
}));

import { UserRepository } from '../src/repositories/UserRepository';
import { NewsRepository } from '../src/repositories/NewsRepository';
import { ReferralRepository } from '../src/repositories/ReferralRepository';
import { StatsRepository } from '../src/repositories/StatsRepository';
import { SourceRepository } from '../src/repositories/SourceRepository';

function mockResult(data: any, error: any = null, count?: number) {
  chain._data = data;
  chain._error = error;
  chain._count = count;
}

beforeEach(() => {
  chain._data = null;
  chain._error = null;
  chain._count = undefined;
  chain.single.mockReset().mockReturnValue(chain);
  chain.maybeSingle.mockReset().mockReturnValue(chain);
  chain.limit.mockReset().mockReturnValue(chain);
  chain.select.mockReset().mockReturnValue(chain);
  chain.eq.mockReset().mockReturnValue(chain);
  chain.or.mockReset().mockReturnValue(chain);
  chain.not.mockReset().mockReturnValue(chain);
  chain.order.mockReset().mockReturnValue(chain);
  chain.insert.mockReset().mockReturnValue(chain);
  chain.upsert.mockReset().mockReturnValue(chain);
  chain.update.mockReset().mockReturnValue(chain);
  chain.delete.mockReset().mockReturnValue(chain);
  chain.rpc.mockReset().mockReturnValue(chain);
});

// ─── UserRepository ─────────────────────────────────────────

describe('UserRepository', () => {
  describe('get', () => {
    it('should return user when found', async () => {
      mockResult({ telegram_id: 123 });
      const r = await UserRepository.get(123);
      expect(r?.telegram_id).toBe(123);
    });
    it('should return null on PGRST116', async () => {
      mockResult(null, { code: 'PGRST116' });
      expect(await UserRepository.get(999)).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return all users', async () => {
      mockResult([{ telegram_id: 1 }, { telegram_id: 2 }]);
      const r = await UserRepository.getAll();
      expect(r).toHaveLength(2);
    });
    it('should return empty on error', async () => {
      mockResult(null, { message: 'err' });
      expect(await UserRepository.getAll()).toEqual([]);
    });
  });

  describe('getActive', () => {
    it('should return active users', async () => {
      mockResult([{ telegram_id: 1, is_active: 1, target_channel: '@ch' }]);
      expect(await UserRepository.getActive()).toHaveLength(1);
    });
  });

  describe('upsert', () => {
    it('should upsert and return user', async () => {
      mockResult({ telegram_id: 123, username: 'test' });
      const r = await UserRepository.upsert(123, 0, 'test', 'Test');
      expect(r?.telegram_id).toBe(123);
    });
  });

  describe('getByReferralCode', () => {
    it('should find user by code', async () => {
      mockResult({ telegram_id: 456, referral_code: 'ABCD' });
      expect(await UserRepository.getByReferralCode('ABCD')).toBeDefined();
    });
  });

  describe('outputChannels', () => {
    it('should merge target + extra channels', () => {
      expect(UserRepository.outputChannels({ target_channel: '@ch', extra_channels: '@a,@b' }))
        .toEqual(['@ch', '@a', '@b']);
    });
    it('should handle no extra channels', () => {
      expect(UserRepository.outputChannels({ target_channel: '@ch', extra_channels: '' }))
        .toEqual(['@ch']);
    });
    it('should handle no channel', () => {
      expect(UserRepository.outputChannels({ target_channel: null, extra_channels: '' })).toEqual([]);
    });
  });
});

// ─── NewsRepository ─────────────────────────────────────────

describe('NewsRepository', () => {
  describe('isSeenByUrl', () => {
    it('should return true when URL exists', async () => {
      mockResult([{ id: 1 }]);
      expect(await NewsRepository.isSeenByUrl(123, 'https://x.com/a')).toBe(true);
    });
    it('should return false when not found', async () => {
      mockResult([]);
      expect(await NewsRepository.isSeenByUrl(123, 'https://x.com/b')).toBe(false);
    });
  });

  describe('isSeenByTitle', () => {
    it('should return false when no titles', async () => {
      mockResult([]);
      expect(await NewsRepository.isSeenByTitle(123, 'new title')).toBe(false);
    });
    it('should detect duplicate title', async () => {
      mockResult([{ title: 'Old' }]);
      (isLikelyDuplicate as jest.Mock).mockReturnValueOnce(true);
      expect(await NewsRepository.isSeenByTitle(123, 'old')).toBe(true);
    });
  });

  describe('isSeen', () => {
    it('should return false for new content', async () => {
      mockResult([]);
      expect(await NewsRepository.isSeen(123, 'url', 'New')).toBe(false);
    });
  });

  describe('markSeen', () => {
    it('should upsert processed news', async () => {
      mockResult(null, null);
      await expect(NewsRepository.markSeen(123, 'url', 'title')).resolves.not.toThrow();
    });
  });

  describe('getLastTitles', () => {
    it('should return title strings', async () => {
      mockResult([{ title: 'A' }, { title: 'B' }]);
      const r = await NewsRepository.getLastTitles(123, 5);
      expect(r).toEqual(['A', 'B']);
    });
  });
});

// ─── ReferralRepository ─────────────────────────────────────

describe('ReferralRepository', () => {
  describe('has', () => {
    it('should return true when exists', async () => {
      mockResult({ id: 1 });
      expect(await ReferralRepository.has(123)).toBe(true);
    });
    it('should return false when not found', async () => {
      mockResult(null);
      expect(await ReferralRepository.has(999)).toBe(false);
    });
  });

  describe('create', () => {
    it('should create when user has none', async () => {
      mockResult(null);
      chain.insert.mockReturnValue(chain);
      expect(await ReferralRepository.create(456, 123)).toBe(true);
    });
    it('should not create duplicate', async () => {
      mockResult({ id: 1 });
      expect(await ReferralRepository.create(456, 123)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should count active and total', async () => {
      mockResult([{ is_active: true }, { is_active: true }, { is_active: false }]);
      const s = await ReferralRepository.getStats(456);
      expect(s.total).toBe(3);
      expect(s.active).toBe(2);
    });
  });
});

// ─── StatsRepository ────────────────────────────────────────

describe('StatsRepository', () => {
  describe('increment', () => {
    it('should call rpc', async () => {
      chain.rpc.mockReturnValue(chain);
      mockResult(null, null);
      await expect(StatsRepository.increment(123, 'total_posts')).resolves.not.toThrow();
    });
  });
  describe('get', () => {
    it('should return stats', async () => {
      mockResult({ total_posts: 5, total_duplicates: 2 });
      const s = await StatsRepository.get(123);
      expect(s?.total_posts).toBe(5);
    });
  });
});

// ─── SourceRepository ───────────────────────────────────────

describe('SourceRepository', () => {
  describe('getByUser', () => {
    it('should return user sources', async () => {
      mockResult([{ id: 1, name: 'RSS' }]);
      const r = await SourceRepository.getByUser(123);
      expect(r).toHaveLength(1);
    });
  });
  describe('getAll', () => {
    it('should return all sources', async () => {
      mockResult([{ id: 1 }, { id: 2 }]);
      const r = await SourceRepository.getAll();
      expect(r).toHaveLength(2);
    });
  });
  describe('add', () => {
    it('should insert source', async () => {
      chain.insert.mockReturnValue(chain);
      mockResult(null, null);
      await expect(SourceRepository.add(123, 'Test', 'http://rss.com', 'uz')).resolves.not.toThrow();
    });
  });
  describe('remove', () => {
    it('should delete source', async () => {
      mockResult(null, null);
      await expect(SourceRepository.remove(123, 1)).resolves.not.toThrow();
    });
  });
});
