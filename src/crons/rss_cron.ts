import cron from 'node-cron';
import { DBService } from '../services/database';
import { isRedisAvailable, addScraperJob } from '../services/queue';
import { RssService } from '../services/rss_service';
import { logger } from '../utils/logger';

const userLastRun = new Map<number, number>();
let lastMonitoredCheck = 0;
const MONITORED_CHECK_INTERVAL = 5 * 60 * 1000;

export function setupRSSCron() {
  cron.schedule('0 0 * * *', async () => {
    try {
      const activeUsers = await DBService.getActiveUsers();
      const activeIds = new Set(activeUsers.map(u => u.telegram_id));
      await RssService.pruneCache(activeIds);
      logger.info('Memory cleanup: userLastRun cache pruned');
    } catch (err: any) {
      logger.error(`Memory cleanup cron failed: ${err.message}`);
    }
  });

  cron.schedule('*/2 * * * *', async () => {
    try {
      const users = await DBService.getActiveUsers();
      const now = Date.now();
      if (now - lastMonitoredCheck > MONITORED_CHECK_INTERVAL) {
        lastMonitoredCheck = now;
        await RssService.checkMonitoredChannels().catch(err => logger.error(`checkMonitoredChannels: ${err.message}`));
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
        const tzOffset = 5 * 60 * 60 * 1000;
        const nowObj = new Date(nowMs + tzOffset);
        const currentH = nowObj.getUTCHours().toString().padStart(2, '0');
        const currentM = nowObj.getUTCMinutes().toString().padStart(2, '0');
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
        } else if (nowMs - lastRun < intervalMs) {
          continue;
        }

        userLastRun.set(user.telegram_id, nowMs);

        const sources = await DBService.getUserSources(user.telegram_id);
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
            await RssService.processDirectly(user.telegram_id, source);
          }
        }
      }
    } catch (error) {
      logger.error(`RSS Cron Error: ${error}`);
    }
  });

  logger.info('RSS cron scheduled (every 2 min, respects user intervals)');
}
