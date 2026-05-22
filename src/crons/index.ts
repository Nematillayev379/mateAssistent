import cron from "node-cron";
import axios from "axios";
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";

export function setupSystemCrons() {
  if (process.env.RENDER_SLEEP === "1" || !process.env.RENDER_SERVICE_ID) {
    scheduleSelfPing();
  }
  schedulePriceTracker();
  scheduleDailyDigest();
  scheduleCleanup();
  scheduleClusterDigest();
  scheduleWorkspaceRebalance();
  scheduleKeyPoolRefresh();
}

function scheduleSelfPing() {
  cron.schedule("*/10 * * * *", async () => {
    if (!CONFIG.PUBLIC_URL) return;
    try { await axios.get(CONFIG.PUBLIC_URL, { timeout: 10000 }); } catch {}
  });
}

function schedulePriceTracker() {
  cron.schedule("0 */4 * * *", async () => {
    try {
      const { PriceTrackerService } = await import("../services/pricetracker");
      await PriceTrackerService.runPriceChecks();
    } catch (err: any) {
      logger.error(`Price Tracker Cron Error: ${err.message}`);
    }
  });
}

function scheduleDailyDigest() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { processDailyDigests } = await import("../crons/digest_cron");
      await processDailyDigests();
    } catch (err: any) {
      logger.warn(`Daily digest cron: ${err.message}`);
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
    } catch (err: any) {
      logger.error(`System Cleanup Error: ${err.message}`);
    }
  });
}

function scheduleClusterDigest() {
  cron.schedule("0 */4 * * *", async () => {
    try {
      const { ClusteringService } = await import("../services/clustering");
      const { DBService } = await import("../services/database");
      const activeUsers = await DBService.getActiveUsers();
      for (const u of activeUsers) {
        if (u.target_channel) {
          await ClusteringService.sendClusterDigest(u.telegram_id, u.target_channel);
          await new Promise(r => setTimeout(r, 200));
        }
      }
    } catch (err: any) {
      logger.error(`Cluster digest cron: ${err.message}`);
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
    } catch (err: any) {
      logger.error(`Workspace rebalance cron: ${err.message}`);
    }
  });
}

function scheduleKeyPoolRefresh() {
  cron.schedule("0 * * * *", async () => {
    try {
      const { refreshKeyPool } = await import("../services/ai");
      await refreshKeyPool();
    } catch (err: any) {
      logger.error(`Key Pool Refresh Error: ${err.message}`);
    }
  });
}
