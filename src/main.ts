import { CONFIG } from "./config/config";
import { logger } from "./utils/logger";
import { bot, startBot } from "./services/telegram";
import { startDashboardServer } from "./services/dashboard";
import { startWorkers } from "./workers";
import { setupRSSCron } from "./crons/rss_cron";
import cron from "node-cron";
import axios from 'axios';
import dns from 'dns';
import { resolveYtDlpPath } from './utils/ytdlp';
import pkg from '../package.json';

// Fix for Render/Node18+ AggregateError (forces IPv4)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

async function bootstrap() {
  logger.info(`🚀 Bot deployed at ${new Date().toISOString()}, version ${pkg.version}`);
  logger.info("🚀 Bootstrapping mateAssistent Bot Ecosystem...");

  // Deploy healthcheck — log which ENV vars are actually present
  logger.info("🔧 Deploy env check:", {
    node_version: process.version,
    cwd: process.cwd(),
    NODE_ENV: process.env.NODE_ENV || "(unset)",
    PORT: process.env.PORT || "(unset)",
    TELEGRAM_TOKEN_set: !!process.env.TELEGRAM_TOKEN,
    TELEGRAM_BOT_TOKEN_set: !!process.env.TELEGRAM_BOT_TOKEN,
    OWNER_ID: process.env.OWNER_ID || "(unset)",
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    PUBLIC_URL: process.env.PUBLIC_URL || "(unset)",
    TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || "(unset)",
    GROQ_KEYS_count: (process.env.GROQ_KEYS?.split(',') ?? []).filter(Boolean).length,
    GEMINI_KEYS_set: !!process.env.GEMINI_KEYS,
    CEREBRAS_KEYS_set: !!process.env.CEREBRAS_KEYS,
    OPENROUTER_KEYS_set: !!process.env.OPENROUTER_KEYS,
    REDIS_URL_set: !!process.env.REDIS_URL,
  });

  // B-08 Fix: Validate TELEGRAM_BOT_TOKEN on startup
  if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error('❌ TELEGRAM_BOT_TOKEN must be set in environment variables!');
    process.exit(1);
  }

  // BUG-C3 Fix: Validate DASHBOARD_SECRET during bootstrap instead of early import throw
  if (!CONFIG.DASHBOARD_SECRET) {
    logger.error('❌ DASHBOARD_SECRET environment variable is REQUIRED! Add DASHBOARD_SECRET to your environment variables.');
    process.exit(1);
  }

  try {
    // BUG-001 & #002: Critical Service Initialization
    const { initI18n } = await import("./services/i18n");
    const { refreshKeyPool } = await import("./services/ai");
    await initI18n();
    await refreshKeyPool();
    const { getActiveKeyStats } = await import("./services/ai");
    const { getEnvKeySourceReport } = await import("./config/config");
    const keyStats = getActiveKeyStats();
    const envSources = getEnvKeySourceReport();
    logger.info(`✅ AI KeyPool: ${keyStats.total} ta kalit yuklandi`, {
      byProvider: keyStats.byProvider,
      envVars: envSources,
    });
    if (keyStats.total === 0) {
      logger.warn('⚠️  AI KEY POOL BO\'SH! Render .env: GROQ_KEYS=key1,key2,key3 formatida tekshiring.');
    }

    // BUG-XXX Fix: Verify yt-dlp binary at startup to surface Windows/permission issues early
    try {
      const ytDlpBinary = await resolveYtDlpPath();
      if (ytDlpBinary) {
        logger.info(`✅ yt-dlp topildi: ${ytDlpBinary}`);
      } else {
        logger.warn('⚠️  yt-dlp EXECUTABLE topilmadi! Musiqa va video yuklash Cobalt API orqali ishlaydi. yt-dlp.exe ni loyiha ildiziga qo\'shing.');
      }
    } catch (e: any) {
      logger.warn(`⚠️  yt-dlp tekshirishda xatolik: ${e.message}`);
    }

    // 1. Start Dashboard
    // B-31 Fix: Parse PORT as integer
    const PORT = parseInt(process.env.PORT || '3000', 10);
    startDashboardServer(PORT, bot);

    // 2. Start Bot
    await startBot();

    // 3. Start Background Workers
    await startWorkers();

    // 4. Start Post Scheduler
    const { SchedulerService } = await import('./services/scheduler');
    SchedulerService.setup();

    // 5. Setup Cron Jobs — always run regardless of webhook/polling mode
    // BUG-003 Fix: Crons must run in both webhook AND polling modes.
    // startBot() already handles webhook vs polling selection — no duplicate calls here.
    setupRSSCron();
    setupSystemCrons();
  } catch (err: any) {
    logger.error(`🔥 Fatal Initialization Error: ${err.message}`);
    process.exit(1);
  }
}

function setupSystemCrons() {
  // 1. Self-ping to keep Render service alive (only if not on paid plan)
  if (process.env.RENDER_SLEEP === '1' || !process.env.RENDER_SERVICE_ID) {
    cron.schedule('*/10 * * * *', async () => {
      if (!CONFIG.PUBLIC_URL) return;
      try {
        await axios.get(CONFIG.PUBLIC_URL, { timeout: 10000 });
      } catch {}
    });
  }

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
      logger.warn(`Daily digest cron: ${err.message}`);
    }
  });

  // 4. System Cleanup (Every 6 hours)
  cron.schedule('0 */6 * * *', async () => {
    try {
      const { DownloaderService } = await import('./services/downloader');
      const { MusicService } = await import('./services/music');
      const { DBService } = await import('./services/database');
      
      await DownloaderService.cleanup();
      await MusicService.cleanup();
      await DBService.cleanupOldEmbeddings(7);
      // BUG-020 Fix: Cleanup expired premium users
      await DBService.cleanupExpiredPremium();
      
      logger.info(`🧹 System cleanup completed`);
    } catch (err: any) {
      logger.error(`❌ System Cleanup Error: ${err.message}`);
    }
  });

  // 5. Refresh Key Pool every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const { refreshKeyPool } = await import('./services/ai');
      await refreshKeyPool();
    } catch (err: any) {
      logger.error(`❌ Key Pool Refresh Error: ${err.message}`);
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

let shuttingDown = false;

process.on('SIGTERM', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('SIGTERM received, shutting down gracefully');
  try {
    bot.stopPolling();
    const { gracefulShutdown } = await import('./services/memory_queue');
    await gracefulShutdown(8000);
  } catch {}
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('SIGINT received, shutting down gracefully');
  try {
    bot.stopPolling();
    const { gracefulShutdown } = await import('./services/memory_queue');
    await gracefulShutdown(5000);
  } catch {}
  process.exit(0);
});
