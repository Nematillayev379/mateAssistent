import { DBService } from '../services/database';
import { logger } from '../utils/logger';
import { getSmartAIResponse } from '../services/ai';
import { bot } from '../services/bot_instance';
import { i18n } from '../services/i18n';

export async function processDailyDigests() {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  try {
    const users = await DBService.getUsersWithDigest();
    const today = new Date().toISOString().split('T')[0];

    for (const user of users) {
      if (!user.digest_time) continue;
      
      const [targetH, targetM] = user.digest_time.split(':').map(Number);
      const targetTotal = targetH * 60 + targetM;
      const currentTotal = now.getHours() * 60 + now.getMinutes();
      
      // BUG #41 Fix: If current time is equal to or past target time, and not sent today
      if (currentTotal >= targetTotal && user.digest_last_sent !== today) {
        logger.info(`✨ Sending daily digest to user ${user.telegram_id}`);
        const success = await sendDigest(user);
        if (success) {
          await DBService.updateUser(user.telegram_id, { digest_last_sent: today });
        }
      }
    }
  } catch (err: any) {
    logger.error(`Digest Cron Error: ${err.message}`);
  }
}

async function sendDigest(user: any): Promise<boolean> {
  try {
    const news = await DBService.getRecentTitlesForDigest(user.telegram_id, 24);
    if (!news || news.length === 0) return false;

    const lang = user.language || 'uz';
    
    // BUG #48 Fix: Use selectTopNews to prioritize important articles
    const { selectTopNews } = await import('../services/ai');
    const topNews = await selectTopNews(news.map(n => ({ title: n.title, url: n.url })));
    
    const titles = topNews.map((n, i) => `${i + 1}. ${n.title}`).join('\n');

    const systemPrompt = `You are a professional news anchor. Create a concise and catchy daily news digest in ${lang} language based on the following titles. 
    Focus on these specific important events. Use emojis. Keep it friendly. Output HTML formatted text for Telegram.`;
    
    const userPrompt = `News Titles:\n${titles}`;
    const summary = await getSmartAIResponse(systemPrompt, userPrompt);

    if (summary) {
      const header = `🗞 <b>${i18n.t('daily_digest_header', { lng: lang }) || 'Daily News Digest'}</b>\n\n`;
      await bot.sendMessage(user.telegram_id, header + summary, { parse_mode: 'HTML' });
      return true;
    }
    return false;
  } catch (err: any) {
    logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
    return false;
  }
}
