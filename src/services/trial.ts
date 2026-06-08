import { DBService } from './database';
import { logger } from '../utils/logger';

export async function startFreeTrial(userId: number, days: number = 7): Promise<boolean> {
  try {
    const user = await DBService.getUser(userId);
    if (!user) return false;
    
    // Check if user already had a trial
    if (user.trial_used) return false;
    
    // Grant trial premium
    await DBService.setPremium(userId, days);
    await DBService.updateUser(userId, { trial_used: true });
    
    logger.info(`Free trial started for user ${userId} (${days} days)`);
    return true;
  } catch (e) {
    logger.error(`Trial start error: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function isTrialEligible(userId: number): Promise<boolean> {
  try {
    const user = await DBService.getUser(userId);
    if (!user) return false;
    if (user.is_premium) return false;
    if (user.trial_used) return false;
    return true;
  } catch {
    return false;
  }
}
