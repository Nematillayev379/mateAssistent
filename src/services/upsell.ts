import { DBService } from './database';
import { logger } from '../utils/logger';
import { bot } from './bot_instance';
import { i18n } from './i18n';
import { buildDashboardUrl } from './bot_instance';

export async function checkAndShowUpsell(userId: number) {
  try {
    const user = await DBService.getUser(userId);
    if (!user || user.is_premium) return;
    
    const stats = await DBService.getStats(userId);
    const sources = await DBService.getUserSources(userId);
    
    // Upsell after 5 sources (free limit is 3)
    if (sources.length >= 3 && stats.total_posts >= 10) {
      const lang = user.language || 'uz';
      const dashUrl = buildDashboardUrl(userId);
      
      const inlineKeyboard: any[][] = [];
      if (dashUrl) {
        inlineKeyboard.push([{ text: i18n.t('bot_buy_premium', { lng: lang }), callback_data: 'buy_premium' }]);
      }
      
      await bot.sendMessage(userId,
        `⭐ <b>${i18n.t('upsell_title', { lng: lang })}</b>\n\n` +
        i18n.t('upsell_body', { lng: lang }),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }
      ).catch(() => {});
    }
  } catch (e) {
    logger.error(`Upsell check error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function showConversionPrompt(userId: number) {
  try {
    const user = await DBService.getUser(userId);
    if (!user || user.is_premium) return;
    
    const lang = user.language || 'uz';
    const dashUrl = buildDashboardUrl(userId);
    
    // Show conversion prompt after 7 days of usage
    const createdAt = new Date(user.created_at || Date.now());
    const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSinceCreation === 7 || daysSinceCreation === 14 || daysSinceCreation === 30) {
      const inlineKeyboard: any[][] = [];
      if (dashUrl) {
        inlineKeyboard.push([{ text: i18n.t('bot_buy_premium', { lng: lang }), callback_data: 'buy_premium' }]);
      }
      
      await bot.sendMessage(userId,
        `🎉 <b>${i18n.t('conversion_title', { lng: lang })}</b>\n\n` +
        i18n.t('conversion_body', { lng: lang, days: daysSinceCreation }),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }
      ).catch(() => {});
    }
  } catch (e) {
    logger.error(`Conversion prompt error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
