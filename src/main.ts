import { CONFIG } from "./config/config";
import { logger } from "./utils/logger";
import { bot, startBot } from "./services/telegram";
import { startDashboardServer } from "./services/dashboard";
import { startWorkers } from "./workers";
import { setupRSSCron } from "./crons/rss_cron";
import cron from "node-cron";
import axios from 'axios';
import dns from 'dns';

// Fix for Render/Node18+ AggregateError (forces IPv4)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

async function bootstrap() {
  logger.info("🚀 Bootstrapping Newsroom Bot Ecosystem...");

  // 1. Start Dashboard
  const PORT = process.env.PORT || 3000;
  startDashboardServer(PORT, bot);

  // 2. Start Bot
  await startBot();

  // 3. Start Background Workers
  startWorkers();

  // 4. Start Post Scheduler
  const { SchedulerService } = await import('./services/scheduler');
  SchedulerService.setup();

  // 4. Setup Cron Jobs
  setupRSSCron();
  
  // Setup other crons
  setupSystemCrons();

  logger.info("✅ Ecosystem is up and running!");
}

function setupSystemCrons() {
  // 1. Self-ping to keep Render service alive
  cron.schedule('*/10 * * * *', async () => {
    if (!CONFIG.PUBLIC_URL) return;
    try {
      await axios.get(CONFIG.PUBLIC_URL, { timeout: 10000 });
      logger.info(`🌐 Self-ping successful`);
    } catch (err: any) {
      logger.warn(`🌐 Self-ping failed: ${err.message}`);
    }
  });

  // 2. Price Tracker Cron (Every 4 hours)
  cron.schedule('0 */4 * * *', async () => {
    try {
      const { PriceTrackerService } = await import('./services/pricetracker');
      await PriceTrackerService.runPriceChecks();
    } catch (err: any) {
      logger.error(`❌ Price Tracker Cron Error: ${err.message}`);
    }
  });

  // 3. Daily Digest Cron (Every minute, check who needs digest)
  cron.schedule('* * * * *', async () => {
    try {
      const { processDailyDigests } = await import('./crons/digest_cron');
      await processDailyDigests();
    } catch (err: any) {
      // Ignore if file doesn't exist yet, we will create it
    }
  });
}

bootstrap().catch(err => {
  logger.error(`🔥 Fatal Bootstrap Error: ${err.message}`);
  process.exit(1);
});

// Global error handlers
process.on("uncaughtException", (err) => {
  logger.error(`🔥 Uncaught Exception: ${err.message}`);
  logger.error(err.stack || "");
});

process.on("unhandledRejection", (reason: any) => {
  logger.error(`🌐 Unhandled Rejection: ${reason?.message || reason}`);
});
