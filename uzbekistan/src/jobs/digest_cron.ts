import { DBService } from '../services/database';
import { logger } from '../utils/logger';
import { getSmartAIResponse, generateTTS, generateAudioSummary } from '../services/ai';
import { bot } from '../services/bot_instance';
import { i18n } from '../services/i18n';

export async function processDailyDigests() {
  const now = new Date();

  try {
    const users = await DBService.getUsersWithDigest();
    const uzbNow = new Date(now.getTime() + (5 * 60 * 60 * 1000));
    const today = uzbNow.toISOString().split('T')[0];

    for (const user of users) {
      if (!user.digest_time) continue;
      const [targetH, targetM] = user.digest_time.split(':').map(Number);
      const targetTotal = targetH * 60 + targetM;
      const currentTotal = uzbNow.getUTCHours() * 60 + uzbNow.getUTCMinutes();
      let timeDiff = currentTotal - targetTotal;
      if (timeDiff < 0) timeDiff += 1440;
      if (timeDiff >= 0 && timeDiff < 60 && user.digest_last_sent !== today) {
        logger.info(`Sending daily digest to user ${user.telegram_id}`);
        const success = await sendDigest(user, today);
        if (success) {
          await DBService.updateUser(user.telegram_id, { digest_last_sent: today });
        }
      }
    }
  } catch (err: any) {
    logger.error(`Digest Cron Error: ${err.message}`);
  }
}

async function sendDigest(user: any, today: string): Promise<boolean> {
  try {
    const news = await DBService.getRecentTitlesForDigest(user.telegram_id, 24);
    if (!news || news.length === 0) return false;

    const lang = user.language || 'uz';
    const { selectTopNews } = await import('../services/ai');
    const topNews = await selectTopNews(news.map(n => ({ title: n.title, url: n.url })));

    const titles = topNews.map((n, i) => `${i + 1}. ${n.title}`).join('\n');
    const systemPrompt = `You are a professional news anchor. Create a concise and catchy daily news digest in ${lang} language based on the following titles. Focus on these specific important events. Use emojis. Keep it friendly. Output HTML formatted text for Telegram.`;
    const summary = await getSmartAIResponse(systemPrompt, `News Titles:\n${titles}`);

    if (!summary) return false;

    const header = `🗞 <b>${i18n.t('daily_digest_header', { lng: lang }) || 'Daily News Digest'}</b>\n\n`;
    const target = user.target_channel || user.telegram_id;
    await bot.sendMessage(target, header + summary, { parse_mode: 'HTML' });

    // Generate and send audio podcast version
    try {
      const podcastScript = await generateAudioSummary('Kunlik yangiliklar podkasti', topNews.map(n => n.title).join('. '), lang);
      if (podcastScript) {
        const audio = await generateTTS(podcastScript, lang);
        if (audio) {
          const audioCaption = `🎙 <b>${today} audio digest</b>\n\n${podcastScript.slice(0, 200)}...`;
          await bot.sendAudio(target, audio, { caption: audioCaption, parse_mode: 'HTML', title: `Daily Podcast ${today}`, performer: 'AI News Bot' });
          logger.info(`Audio digest sent to ${user.telegram_id}`);
        }
      }
    } catch (audioErr: any) {
      logger.warn(`Audio digest failed for ${user.telegram_id}: ${audioErr.message}`);
    }

    return true;
  } catch (err: any) {
    logger.error(`Failed to send digest to ${user.telegram_id}: ${err.message}`);
    if (err.message?.includes('Forbidden') || err.message?.includes('blocked')) return true;
    return false;
  }
}
