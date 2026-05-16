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
    // BUG-033 Fix: Use local timezone for 'today' date string to match now.getHours()
    const offsetMs = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now.getTime() - offsetMs);
    const today = localNow.toISOString().split('T')[0];

    for (const user of users) {
      if (!user.digest_time) continue;
      
      const [targetH, targetM] = user.digest_time.split(':').map(Number);
      const targetTotal = targetH * 60 + targetM;
      const currentTotal = now.getHours() * 60 + now.getMinutes();
      
      if (currentTotal >= targetTotal && user.digest_last_sent !== today) {
        logger.info(`✨ Sending daily digest to user ${user.telegram_id}`);
        // BUG-138 Fix: Always update digest_last_sent even if it fails, to avoid infinite retry loops
        await sendDigest(user);
        await DBService.updateUser(user.telegram_id, { digest_last_sent: today });
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
      // BUG-034 Fix: Try to send to target channel if they have one, fallback to PM
      const target = user.target_channel || user.telegram_id;
      await bot.sendMessage(target, header + summary, { parse_mode: 'HTML' });
      return true;
    }
    return false;
  } catch (err: any) {
    logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
    // BUG-138 Fix: Return true on terminal errors like blocked bot to prevent retry loops
    if (err.message?.includes('Forbidden') || err.message?.includes('blocked')) {
      return true; 
    }
    return false;
  }
}
