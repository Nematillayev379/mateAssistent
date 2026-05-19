import cron from 'node-cron';
import { DBService } from '../services/database';
import { isRedisAvailable, addScraperJob } from '../services/queue';
import { ScraperService } from '../services/scraper';
import { processArticleInline } from '../workers/scraper_worker';
import { logger, sanitizeLogInput } from '../utils/logger';
// BUG-097 Fix: Import bot properly
import { bot } from '../services/bot_instance';

const userLastRun = new Map<number, number>();
// BUG-096 Fix: Track last monitored channel check
let lastMonitoredCheck = 0;
const MONITORED_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function setupRSSCron() {
  // BUG-030 & BUG-146 Fix: Prune inactive users instead of full clear to prevent midnight thundering herd
  cron.schedule('0 0 * * *', async () => {
    try {
      const activeUsers = await DBService.getActiveUsers();
      const activeIds = new Set(activeUsers.map(u => u.telegram_id));
      for (const id of userLastRun.keys()) {
        if (!activeIds.has(id)) userLastRun.delete(id);
      }
      logger.info('🧹 Memory cleanup: userLastRun cache pruned');
    } catch (err: any) {
      logger.error(`❌ Memory cleanup cron failed: ${err.message}`);
    }
  });

  cron.schedule('*/2 * * * *', async () => {
    try {
      const users = await DBService.getActiveUsers();
      
      // BUG-096 Fix: Rate limit monitored channel checks
      const now = Date.now();
      if (now - lastMonitoredCheck > MONITORED_CHECK_INTERVAL) {
        lastMonitoredCheck = now;
        await checkMonitoredChannels().catch(err => logger.error(`checkMonitoredChannels: ${err.message}`));
      }

      for (const user of users) {
        const intervalMinutes = Math.max(user.interval_minutes || 15, 1);
        const intervalMs = intervalMinutes * 60 * 1000;
        
        let lastRun = userLastRun.get(user.telegram_id);
        // BUG-118 Fix: Randomize initial state on restart to spread network load (Thundering Herd prevention)
        if (lastRun === undefined) {
          lastRun = Date.now() - Math.floor(Math.random() * intervalMs);
          userLastRun.set(user.telegram_id, lastRun);
        }

        const nowMs = Date.now();
        // BUG-M2 Fix: Use Tashkent timezone instead of hosting server local time
        const nowObj = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
        
        const currentH = nowObj.getHours().toString().padStart(2, '0');
        const currentM = nowObj.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentH}:${currentM}`;

        // Strategy 1: Fixed Schedule
        if (user.schedule_times && user.schedule_times.trim() !== '') {
          const times = user.schedule_times.split(',').map((t: string) => {
            // BUG-031 Fix: Safer regex parsing for time
            const match = t.trim().match(/^(\d{1,2})[:.](\d{2})/);
            if (!match) return null;
            const h = parseInt(match[1]);
            const m = parseInt(match[2]);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          }).filter(Boolean);
          
          if (!times.includes(currentTime)) continue;
          if (nowMs - lastRun < 65000) continue;
        } 
        // Strategy 2: Interval
        else if (nowMs - lastRun < intervalMs) {
          continue;
        }

        userLastRun.set(user.telegram_id, nowMs);

        const sources = await DBService.getUserSources(user.telegram_id);
        if (!sources || sources.length === 0) continue;

        logger.info(`⏰ RSS cron: processing ${sources.length} sources for user ${user.telegram_id}`);

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
    } catch (error) {
      logger.error(`❌ RSS Cron Error: ${error}`);
    }
  });

  logger.info('📅 RSS cron scheduled (every 2 min, respects user intervals)');
}

// BUG-097 Fix: Use imported bot instance
async function checkMonitoredChannels() {
  try {
    const channels = await DBService.getMonitoredChannels();
    for (const channel of channels) {
      let latestPost: any = null;
      if (channel.platform === 'youtube') {
        const { YoutubeService } = await import('../services/youtube');
        latestPost = await YoutubeService.getLatestVideo(channel.channel_id);
      } else if (channel.platform === 'instagram') {
        const { InstagramService } = await import('../services/instagram');
        latestPost = await InstagramService.getLatestPost(channel.channel_id);
      }

      if (latestPost && latestPost.id !== channel.last_post_id) {
        logger.info(`📢 New post found on ${sanitizeLogInput(channel.platform)} channel ${sanitizeLogInput(channel.name)}`);
        const user = await DBService.getUser(channel.user_id);
        if (user && user.target_channel) {
          const caption = `📢 <b>Yangi ${channel.platform} xabari!</b>\n\n${latestPost.title}\n\n🔗 <a href="${latestPost.url}">Ko'rish</a>`;
          try {
            await bot.sendMessage(user.target_channel, caption, { parse_mode: 'HTML' });
          } catch (e: any) {
            logger.warn(`Failed to send monitored channel update: ${e.message}`);
            // BUG-M3 Fix: Alert the user directly if the bot is not admin/allowed in their target channel
            try {
              const errMsg = `⚠️ <b>Kanalga post yuborib bo'lmadi!</b>\n\nBot <code>${user.target_channel}</code> kanalida administrator emas yoki xabar yuborish huquqi yo'q. Iltimos, botni kanalga admin qilib qo'shing.\n\nPost: ${latestPost.title}`;
              await bot.sendMessage(channel.user_id, errMsg, { parse_mode: 'HTML' });
            } catch (alertErr: any) {
              logger.error(`Failed to alert user ${channel.user_id} about channel permissions: ${alertErr.message}`);
            }
          }
        }
        await DBService.updateMonitoredChannel(channel.id, latestPost.id);
      }
    }
  } catch (err: any) {
    logger.error(`checkMonitoredChannels error: ${err.message}`);
  }
}

async function processDirectly(userId: number, source: any): Promise<void> {
  try {
    const articles: any[] = await ScraperService.fetchRSS(source.url);
    const lang = source.lang || 'uz';

    for (const article of articles) {
      try {
        const isDuplicate = await DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
        if (isDuplicate) continue;

        logger.info(`🆕 [direct] New article: ${sanitizeLogInput(article.title)}`);

        const articleData = {
          title: article.title,
          url: article.link,
          source: source.name,
          content: article.contentSnippet || article.content || '',
          imageUrl: article.imageUrl || null,
          pubDate: article.pubDate,
        };

        try {
          await processArticleInline(userId, articleData, lang);
          await DBService.markSeen(userId, article.link, article.title);
        } catch (articleErr: any) {
          logger.error(`❌ Error inline processing article ${sanitizeLogInput(article.link)}: ${articleErr.message}`);
        }
      } catch (articleErr: any) {
        logger.error(`❌ Error handling article ${sanitizeLogInput(article.link)}: ${articleErr.message}`);
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️ Direct RSS process error for ${sanitizeLogInput(source.url)}: ${err.message}`);
  }
  }
