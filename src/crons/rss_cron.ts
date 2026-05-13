import cron from 'node-cron';
import { DBService } from '../services/database';
import { isRedisAvailable, addScraperJob } from '../services/queue';
import { ScraperService } from '../services/scraper';
import { processArticleInline } from '../workers/scraper_worker';
import { logger } from '../utils/logger';

const userLastRun = new Map<number, number>();

export function setupRSSCron() {
  // Bug #37 Fix: Periodically clear memory cache to prevent leak
  cron.schedule('0 0 * * *', () => {
    userLastRun.clear();
    logger.info('🧹 Memory cleanup: userLastRun cache cleared');
  });

  cron.schedule('* * * * *', async () => {
    try {
      const users = await DBService.getActiveUsers();
      
      // BUG #50 Fix: Periodically check monitored channels
      await checkMonitoredChannels();

      for (const user of users) {
        // BUG #63 Fix: Ensure interval is at least 1 minute
        const intervalMinutes = Math.max(user.interval_minutes || 15, 1);
        const intervalMs = intervalMinutes * 60 * 1000;
        
        const lastRun = userLastRun.get(user.telegram_id) || 0;
        const now = Date.now();
        const nowObj = new Date();
        
        // BUG #78 Fix: Normalize current time to HH:MM (padding)
        const currentH = nowObj.getHours().toString().padStart(2, '0');
        const currentM = nowObj.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentH}:${currentM}`;

        // Strategy 1: Fixed Schedule
        if (user.schedule_times && user.schedule_times.trim() !== '') {
          // BUG #78 Fix: Support multiple formats (e.g. 9:0 -> 09:00)
          const times = user.schedule_times.split(',').map((t: string) => {
            const [h, m] = t.trim().split(/[:.]/).map(Number);
            if (isNaN(h) || isNaN(m)) return null;
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          }).filter(Boolean);
          
          if (!times.includes(currentTime)) continue;
          if (now - lastRun < 65000) continue;
        } 
        // Strategy 2: Interval
        else if (now - lastRun < intervalMs) {
          continue;
        }

        userLastRun.set(user.telegram_id, now);

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

  logger.info('📅 RSS cron scheduled (every minute, respects user intervals)');
}

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
        logger.info(`📢 New post found on ${channel.platform} channel ${channel.name}`);
        const user = await DBService.getUser(channel.user_id);
        if (user && user.target_channel) {
          const caption = `📢 <b>Yangi ${channel.platform} xabari!</b>\n\n${latestPost.title}\n\n🔗 <a href="${latestPost.url}">Ko'rish</a>`;
          await bot.sendMessage(user.target_channel, caption, { parse_mode: 'HTML' });
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
        const seen = await DBService.isSeen(userId, article.link);
        if (seen) continue;

        const titleSeen = await DBService.isSeenByTitle(userId, article.title);
        if (titleSeen) continue;

        logger.info(`🆕 [direct] New article: ${article.title}`);

        const articleData = {
          title: article.title,
          url: article.link,
          source: source.name,
          content: article.contentSnippet || article.content || '',
          imageUrl: article.imageUrl || null,
          pubDate: article.pubDate,
        };

        await processArticleInline(userId, articleData, lang);
        await DBService.markSeen(userId, article.link, article.title);
      } catch (articleErr: any) {
        logger.error(`❌ Error processing article ${article.link}: ${articleErr.message}`);
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️ Direct RSS process error for ${source.url}: ${err.message}`);
  }
}
