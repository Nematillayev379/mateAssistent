import cron from "node-cron";
import axios from "axios";
import { isRedisAvailable } from '../services/queue';
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";

export async function startWorkers(): Promise<void> {
  if (!isRedisAvailable()) {
    logger.info('No Redis — using inline processing (memory queue)');
    return;
  }

  try {
    await import('./scraper_worker');
    logger.info('Scraper worker started (AI processing runs inline)');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Workers failed to start: ${message} — falling back to inline processing`);
  }
}

export function setupSystemCrons() {
  scheduleSelfPing();
  scheduleDailyDigest();
  scheduleCleanup();
  scheduleClusterDigest();
  scheduleWorkspaceRebalance();
  scheduleKeyPoolRefresh();
  scheduleDailyRssSearch();
}

function scheduleSelfPing() {
  if (!CONFIG.PUBLIC_URL) {
    logger.warn('Self-ping skipped: PUBLIC_URL not set');
    return;
  }
  cron.schedule("*/10 * * * *", async () => {
    try {
      await axios.get(CONFIG.PUBLIC_URL, { timeout: 10000 });
      logger.debug('Self-ping OK');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      logger.warn(`Self-ping failed: ${message}`);
    }
  });
  logger.info(`Self-ping scheduled every 10 min → ${CONFIG.PUBLIC_URL}`);
}

function scheduleDailyRssSearch() {
  cron.schedule("0 8 * * *", async () => {
    try {
      const { RssSearchService } = await import("../services/rss_search");
      const { DBService } = await import("../services/database");
      const { bot } = await import("../services/bot_instance");
      const users = await DBService.getActiveUsers();

      for (const user of users) {
        const searches = await RssSearchService.getUserSearches(user.telegram_id);
        const dailySearches = searches.filter(s => s.mode === 'daily' && s.isActive);

        for (const search of dailySearches) {
          try {
            const results = await RssSearchService.runSearch(search.id);
            if (results.length > 0) {
              const summary = await RssSearchService.summarizeResults(results, search.topic, user.language || 'uz');
              await bot.sendMessage(user.target_channel || user.telegram_id, summary, { parse_mode: 'HTML' }).catch(() => {});
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.warn(`Daily RSS search failed for ${user.telegram_id}: ${message}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }
      logger.info('Daily RSS search completed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Daily RSS Search Cron Error: ${message}`);
    }
  });
}

function scheduleDailyDigest() {
  cron.schedule("* * * * *", async () => {
    try {
      const { processDailyDigests } = await import("./digest_cron");
      await processDailyDigests();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Daily digest cron: ${message}`);
    }
  });
}

function scheduleCleanup() {
  cron.schedule("0 */6 * * *", async () => {
    try {
      const { DownloaderService } = await import("../services/downloader");
      const { MusicService } = await import("../services/music");
      const { DBService } = await import("../services/database");
      await DownloaderService.cleanup();
      await MusicService.cleanup();
      await DBService.cleanupOldEmbeddings(7);
      await DBService.cleanupExpiredPremium();
      logger.info("System cleanup completed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`System Cleanup Error: ${message}`);
    }
  });
}

function scheduleClusterDigest() {
  cron.schedule("0 */4 * * *", async () => {
    try {
      const { ClusteringService } = await import('../services/clustering');
      const { DBService } = await import('../services/database');
      const activeUsers = await DBService.getActiveUsers();
      for (const u of activeUsers) {
        if (u.daily_digest && u.target_channel) {
          await ClusteringService.sendClusterDigest(u.telegram_id, u.target_channel);
          await new Promise(r => setTimeout(r, 200));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Cluster digest cron: ${message}`);
    }
  });
}

function scheduleWorkspaceRebalance() {
  cron.schedule("0 */6 * * *", async () => {
    try {
      const { WorkspaceService } = await import("../services/workspace");
      const { DBService } = await import("../services/database");
      const users = await DBService.getActiveUsers();
      for (const u of users) {
        const workspaces = await DBService.getUserWorkspaces(u.telegram_id);
        for (const ws of workspaces) {
          await WorkspaceService.rebalanceContent(ws.id);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Workspace rebalance cron: ${message}`);
    }
  });
}

function scheduleKeyPoolRefresh() {
  cron.schedule("0 * * * *", async () => {
    try {
      const { refreshKeyPool } = await import("../services/ai");
      await refreshKeyPool();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Key Pool Refresh Error: ${message}`);
    }
  });
}
