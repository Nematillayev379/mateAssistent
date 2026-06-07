process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { referral_code: 'TESTCODE' }, error: null }),
    update: jest.fn().mockResolvedValue({ error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  }),
}));

import { DBService } from '../src/services/database';

describe('DBService', () => {
  it('should generate a referral code', async () => {
    const userId = 123456789;
    // With mocking, it should return defined value without real DB
    const code = await DBService.ensureReferralCode(userId);
    expect(code).toBeDefined();
  });
});
