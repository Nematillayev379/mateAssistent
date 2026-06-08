import { DBService } from './database';
import { logger } from '../utils/logger';

export interface SubscriptionMetrics {
  totalActive: number;
  totalExpired: number;
  newThisMonth: number;
  churnRate: number;
  mrr: number; // Monthly Recurring Revenue
  arr: number; // Annual Recurring Revenue
  ltv: number; // Lifetime Value
  conversionRate: number;
  renewalRate: number;
}

export async function getSubscriptionMetrics(): Promise<SubscriptionMetrics> {
  try {
    const users = await DBService.getAllUsers();
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    let totalActive = 0;
    let totalExpired = 0;
    let newThisMonth = 0;
    let totalRevenue = 0;
    
    for (const user of users) {
      if (user.is_premium && user.premium_until) {
        const expiresAt = new Date(user.premium_until);
        if (expiresAt > now) {
          totalActive++;
          totalRevenue += 25000; // Monthly price in UZS
        } else {
          totalExpired++;
        }
      }
      
      const createdAt = new Date(user.created_at || Date.now());
      if (createdAt >= thisMonth && user.is_premium) {
        newThisMonth++;
      }
    }
    
    const totalUsers = users.length;
    const conversionRate = totalUsers > 0 ? (totalActive / totalUsers) * 100 : 0;
    const churnRate = totalActive + totalExpired > 0 ? (totalExpired / (totalActive + totalExpired)) * 100 : 0;
    
    return {
      totalActive,
      totalExpired,
      newThisMonth,
      churnRate: Math.round(churnRate * 100) / 100,
      mrr: totalActive * 25000,
      arr: totalActive * 25000 * 12,
      ltv: totalActive > 0 ? Math.round(totalRevenue / totalActive) : 0,
      conversionRate: Math.round(conversionRate * 100) / 100,
      renewalRate: 100 - churnRate,
    };
  } catch (e) {
    logger.error(`Subscription metrics error: ${e instanceof Error ? e.message : String(e)}`);
    return {
      totalActive: 0, totalExpired: 0, newThisMonth: 0, churnRate: 0,
      mrr: 0, arr: 0, ltv: 0, conversionRate: 0, renewalRate: 0,
    };
  }
}

export async function trackConversionEvent(userId: number, event: 'view_pricing' | 'start_trial' | 'purchase' | 'renewal' | 'churn') {
  logger.info(`Conversion event: user=${userId}, event=${event}`);
  // Could be extended to store in DB for analytics
}
