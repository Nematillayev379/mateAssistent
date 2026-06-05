import { DBService } from '../services/database';
import { logger } from '../utils/logger';
import { getSmartAIResponse, generateTTS, generateAudioSummary } from '../services/ai';
import { bot } from '../services/bot_instance';
import { i18n } from '../services/i18n';
import { CONFIG } from '../config/config';

let digestJobRunning = false;

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
  };
}

export async function processDailyDigests() {
  if (digestJobRunning) {
    logger.debug('Daily digest already running; skipping this tick.');
    return;
  }

  digestJobRunning = true;
  try {
    const users = await DBService.getUsersWithDigest();
    const now = new Date();
    const zonedNow = getZonedParts(now, CONFIG.TIMEZONE);
    const currentTotal = zonedNow.hour * 60 + zonedNow.minute;
    const today = zonedNow.date;

    for (const user of users) {
      if (!user.daily_digest) continue;
      if (!user.digest_time) continue;
      const [targetH, targetM] = user.digest_time.split(':').map(Number);
      if (Number.isNaN(targetH) || Number.isNaN(targetM)) continue;
      const targetTotal = targetH * 60 + targetM;

      const diff = currentTotal - targetTotal;
      const isOnTime = diff >= 0 && diff < 3;
      const isAfterMidnight = currentTotal < 60 && targetTotal >= 1380;
      const isMatch = isOnTime || isAfterMidnight;

      if (isMatch && user.digest_last_sent !== today) {
        logger.info(`Sending daily digest to user ${user.telegram_id} (target=${user.digest_time}, current=${String(zonedNow.hour).padStart(2,'0')}:${String(zonedNow.minute).padStart(2,'0')})`);
        const success = await sendDigest(user, today);
        if (success) {
          await DBService.updateUser(user.telegram_id, { digest_last_sent: today });
        }
      }
    }
  } catch (err: any) {
    logger.error(`Digest Cron Error: ${err.message}`);
  } finally {
    digestJobRunning = false;
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
