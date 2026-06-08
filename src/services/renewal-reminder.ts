import { DBService } from './database';
import { logger } from '../utils/logger';
import { bot } from './bot_instance';
import { i18n } from './i18n';

export async function checkAndSendRenewalReminders() {
  try {
    const users = await DBService.getAllUsers();
    const now = new Date();
    
    for (const user of users) {
      if (!user.is_premium || !user.premium_until) continue;
      
      const expiresAt = new Date(user.premium_until);
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      // Send reminder 3 days before expiry
      if (daysLeft === 3 || daysLeft === 1) {
        const lang = user.language || 'uz';
        const daysText = daysLeft === 3 ? i18n.t('renewal_3_days', { lng: lang }) : i18n.t('renewal_1_day', { lng: lang });
        
        await bot.sendMessage(user.telegram_id, 
          `⭐ <b>${daysText}</b>\n\n` +
          i18n.t('renewal_reminder', { lng: lang }),
          { parse_mode: 'HTML' }
        ).catch(() => {});
        
        logger.info(`Renewal reminder sent to ${user.telegram_id} (${daysLeft} days left)`);
      }
      
      // Send post-expiry message
      if (daysLeft === 0) {
        const lang = user.language || 'uz';
        await bot.sendMessage(user.telegram_id,
          `😔 <b>${i18n.t('premium_expired', { lng: lang })}</b>\n\n` +
          i18n.t('premium_expired_body', { lng: lang }),
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }
  } catch (e) {
    logger.error(`Renewal reminder error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
