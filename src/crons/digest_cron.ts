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
    for (const user of users) {
      if (user.digest_time === currentTime) {
        logger.info(`✨ Sending daily digest to user ${user.telegram_id}`);
        await sendDigest(user);
      }
    }
  } catch (err: any) {
    logger.error(`Digest Cron Error: ${err.message}`);
  }
}

async function sendDigest(user: any) {
  try {
    const news = await DBService.getRecentTitlesForDigest(user.telegram_id, 24);
    if (!news || news.length === 0) return;

    const lang = user.language || 'uz';
    const titles = news.map((n, i) => `${i + 1}. ${n.title}`).join('\n');

    const systemPrompt = `You are a professional news anchor. Create a concise and catchy daily news digest in ${lang} language based on the following titles. 
    Focus on the most important events. Use emojis. Keep it friendly. Output HTML formatted text for Telegram.`;
    
    const userPrompt = `News Titles:\n${titles}`;
    const summary = await getSmartAIResponse(systemPrompt, userPrompt);

    if (summary) {
      const header = `🗞 <b>${i18n.t('daily_digest_header', { lng: lang }) || 'Daily News Digest'}</b>\n\n`;
      await bot.sendMessage(user.telegram_id, header + summary, { parse_mode: 'HTML' });
    }
  } catch (err: any) {
    logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
  }
}
