import WebSocket from 'ws';
import { CONFIG } from "./config/config";
import { logger } from "./utils/logger";
import { bot, startBot } from "./services/telegram";
import { startDashboardServer } from "./services/dashboard";
import { startWorkers, setupSystemCrons } from "./jobs";
import { setupRSSCron } from "./jobs/rss_cron";
import { resolveYtDlpPath } from './utils/ytdlp';
import { initSentry, captureError } from './services/sentry';
import pkg from '../package.json';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

const _startTime = Date.now();
logger.info(`Process started at ${new Date().toISOString()}, PID ${process.pid}`);

initSentry();

function shouldRunSingletonJobs(): boolean {
  const instance = process.env.NODE_APP_INSTANCE;
  return !instance || instance === '0';
}

async function bootstrap() {
  logger.info(`Bootstrap started, elapsed ${Date.now() - _startTime}ms`);
  logger.info(`Bot deployed at ${new Date().toISOString()}, version ${pkg.version}`);
  logger.info("Bootstrapping Bot Ecosystem...");

  if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN must be set in environment variables!');
    process.exit(1);
  }
  if (!CONFIG.DASHBOARD_SECRET) {
    logger.error('DASHBOARD_SECRET environment variable is REQUIRED!');
    process.exit(1);
  }

  try {
    const { SecretManager } = await import("./services/secret_manager");
    await SecretManager.init();
    logger.info(`Secret backend: ${SecretManager.getBackend()}`);

    const { initI18n } = await import("./services/i18n");
    const { refreshKeyPool, getActiveKeyStats } = await import("./services/ai");
    const { getEnvKeySourceReport } = await import("./config/config");
    await initI18n();
    await refreshKeyPool();
    const keyStats = getActiveKeyStats();
    logger.info(`AI KeyPool: ${keyStats.total} keys loaded`, { byProvider: keyStats.byProvider, envVars: getEnvKeySourceReport() });
    if (keyStats.total === 0) logger.warn('AI KEY POOL IS EMPTY! Check Render .env vars.');

    try {
      const ytDlpBinary = await resolveYtDlpPath();
      if (ytDlpBinary) logger.info(`yt-dlp found: ${ytDlpBinary}`);
      else logger.warn('yt-dlp not found. Downloads will use Cobalt API.');
    } catch (e: any) {
      logger.warn(`yt-dlp check error: ${e.message}`);
    }

    const PORT = parseInt(process.env.PORT || '3000', 10);
    startDashboardServer(PORT, bot);
    await startBot();
    await startWorkers();
    if (shouldRunSingletonJobs()) {
      const { SchedulerService } = await import('./services/scheduler');
      SchedulerService.setup();
      setupRSSCron();
      setupSystemCrons();

      const { setupHealthMonitoring } = await import('./services/health_monitor');
      setupHealthMonitoring();
      logger.info('Singleton cron jobs enabled on this instance');
    } else {
      logger.info(`Singleton cron jobs skipped on PM2 instance ${process.env.NODE_APP_INSTANCE}`);
    }

    if (CONFIG.OWNER_ID) {
      bot.sendMessage(CONFIG.OWNER_ID, `✅ Bot started\nVersion: ${pkg.version}\nUptime: ${Math.round(process.uptime())}s`).catch(() => {});
    }
  } catch (err: any) {
    captureError(err, { type: 'bootstrap' });
    logger.error(`Fatal Initialization Error: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

bootstrap().catch(err => {
  logger.error(`🔥 Fatal Bootstrap Error: ${err.message}`);
  process.exit(1);
});

// Global error handlers
process.on("uncaughtException", (err) => {
  captureError(err, { type: 'uncaughtException' });
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason: any) => {
  captureError(reason instanceof Error ? reason : new Error(String(reason)), { type: 'unhandledRejection' });
  logger.error(`Unhandled Rejection: ${reason?.message || reason}`);
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
  } catch { logger.warn(`SIGTERM shutdown error`); }
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
  } catch { logger.warn(`SIGINT shutdown error`); }
  process.exit(0);
});
