import cron from 'node-cron';
import { DBService } from '../services/database';
import { isRedisAvailable, addScraperJob } from '../services/queue';
import { ScraperService } from '../services/scraper';
import { processArticleInline } from '../workers/scraper_worker';
import { logger, sanitizeLogInput } from '../utils/logger';
import { bot } from '../services/bot_instance';
import { NewsSource, RssItem } from '../types';

interface MonitoredPost {
  id: string;
  title: string;
  url?: string;
}

const userLastRun = new Map<number, number>();
let lastMonitoredCheck = 0;
const MONITORED_CHECK_INTERVAL = 5 * 60 * 1000;

export function setupRSSCron() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const activeUsers = await DBService.getActiveUsers();
      const activeIds = new Set(activeUsers.map(u => u.telegram_id));
      for (const id of userLastRun.keys()) {
        if (!activeIds.has(id)) userLastRun.delete(id);
      }
      logger.info('Memory cleanup: userLastRun cache pruned');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Memory cleanup cron failed: ${msg}`);
    }
  });

  cron.schedule('*/2 * * * *', async () => {
    try {
      const users = await DBService.getActiveUsers();
      
      const now = Date.now();
      if (now - lastMonitoredCheck > MONITORED_CHECK_INTERVAL) {
        lastMonitoredCheck = now;
        await checkMonitoredChannels().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`checkMonitoredChannels: ${msg}`);
        });
      }

      for (const user of users) {
        const intervalMinutes = Math.max(user.interval_minutes || 15, 1);
        const intervalMs = intervalMinutes * 60 * 1000;
        
        let lastRun = userLastRun.get(user.telegram_id);
        if (lastRun === undefined) {
          lastRun = Date.now() - Math.floor(Math.random() * intervalMs);
          userLastRun.set(user.telegram_id, lastRun);
        }

        const nowMs = Date.now();
        const nowObj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
        
        const currentH = nowObj.getHours().toString().padStart(2, '0');
        const currentM = nowObj.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentH}:${currentM}`;

        if (user.schedule_times && user.schedule_times.trim() !== '') {
          const times = user.schedule_times.split(',').map((t: string) => {
            const match = t.trim().match(/^(\d{1,2})[:.](\d{2})/);
            if (!match) return null;
            const h = parseInt(match[1]);
            const m = parseInt(match[2]);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          }).filter(Boolean);
          
          if (!times.includes(currentTime)) continue;
          if (nowMs - lastRun < 65000) continue;
        } 
        else if (nowMs - lastRun < intervalMs) {
          continue;
        }

        userLastRun.set(user.telegram_id, nowMs);

        const sources: NewsSource[] = await DBService.getUserSources(user.telegram_id);
        if (!sources || sources.length === 0) continue;

        logger.info(`RSS cron: processing ${sources.length} sources for user ${user.telegram_id}`);

        for (const source of sources) {
          if (isRedisAvailable()) {
            await addScraperJob({
              userId: user.telegram_id,
              sourceUrl: source.url,
              sourceName: source.name,
              lang: source.lang || 'uz',
            });
          } else {
            await processDirectly(user.telegram_id, source);
          }
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`RSS Cron Error: ${msg}`);
    }
  });

  logger.info('RSS cron scheduled (every 2 min, respects user intervals)');
}

async function checkMonitoredChannels() {
  try {
    const channels = await DBService.getMonitoredChannels();
    for (const channel of channels) {
      let latestPost: MonitoredPost | null = null;
      if (channel.platform === 'youtube') {
        const { YoutubeService } = await import('../services/youtube');
        latestPost = await YoutubeService.getLatestVideo(channel.channel_id);
      } else if (channel.platform === 'instagram') {
        const { InstagramService } = await import('../services/instagram');
        latestPost = await InstagramService.getLatestPost(channel.channel_id);
      }

      if (latestPost && latestPost.id !== channel.last_post_id) {
        logger.info(`New post found on ${sanitizeLogInput(channel.platform)} channel ${sanitizeLogInput(channel.name)}`);
        const user = await DBService.getUser(channel.user_id);
        if (user && user.target_channel) {
          const caption = `📢 <b>Yangi ${channel.platform} xabari!</b>\n\n${latestPost.title}\n\n🔗 <a href="${latestPost.url}">Ko'rish</a>`;
          try {
            await bot.sendMessage(user.target_channel, caption, { parse_mode: 'HTML' });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`Failed to send monitored channel update: ${msg}`);
            try {
              const errMsg = `⚠️ <b>Kanalga post yuborib bo'lmadi!</b>\n\nBot <code>${user.target_channel}</code> kanalida administrator emas yoki xabar yuborish huquqi yo'q. Iltimos, botni kanalga admin qilib qo'shing.\n\nPost: ${latestPost.title}`;
              await bot.sendMessage(channel.user_id, errMsg, { parse_mode: 'HTML' });
            } catch (alertErr: unknown) {
              const alertMsg = alertErr instanceof Error ? alertErr.message : String(alertErr);
              logger.error(`Failed to alert user ${channel.user_id} about channel permissions: ${alertMsg}`);
            }
          }
        }
        await DBService.updateMonitoredChannel(channel.id, latestPost.id);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`checkMonitoredChannels error: ${msg}`);
  }
}

async function processDirectly(userId: number, source: NewsSource): Promise<void> {
  try {
    const articles: RssItem[] = await ScraperService.fetchRSS(source.url);
    const lang = source.lang || 'uz';

    for (const article of articles) {
      try {
        const isDuplicate = await DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
        if (isDuplicate) continue;

        logger.info(`New article: ${sanitizeLogInput(article.title)}`);

        const articleData = {
          title: article.title,
          url: article.link,
          source: source.name,
          content: article.contentSnippet || article.content || '',
          imageUrl: article.imageUrl || null,
          pubDate: article.pubDate,
        };

        await DBService.markSeen(userId, article.link, article.title);
        try {
          await processArticleInline(userId, articleData, lang);
        } catch (articleErr: unknown) {
          const msg = articleErr instanceof Error ? articleErr.message : String(articleErr);
          logger.error(`Error inline processing article ${sanitizeLogInput(article.link)}: ${msg}`);
        }
      } catch (articleErr: unknown) {
        const msg = articleErr instanceof Error ? articleErr.message : String(articleErr);
        logger.error(`Error handling article ${sanitizeLogInput(article.link)}: ${msg}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Direct RSS process error for ${sanitizeLogInput(source.url)}: ${msg}`);
  }
}
