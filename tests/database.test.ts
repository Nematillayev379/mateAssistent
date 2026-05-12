import { DBService } from '../src/services/database';

describe('DBService', () => {
  it('should generate a referral code', async () => {
    // Mocking might be needed if Supabase is not available
    // For now, testing the logic if possible
    const userId = 123456789;
    const code = await DBService.ensureReferralCode(userId);
    expect(code).toBeDefined();
    expect(code.length).toBeGreaterThan(5);
  });
});
