"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importDefault(require("ws"));
const config_1 = require("./config/config");
const logger_1 = require("./utils/logger");
const telegram_1 = require("./services/telegram");
const dashboard_1 = require("./services/dashboard");
const jobs_1 = require("./jobs");
const rss_cron_1 = require("./jobs/rss_cron");
const ytdlp_1 = require("./utils/ytdlp");
const sentry_1 = require("./services/sentry");
const package_json_1 = __importDefault(require("../package.json"));
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = ws_1.default;
}
const _startTime = Date.now();
logger_1.logger.info(`Process started at ${new Date().toISOString()}, PID ${process.pid}`);
(0, sentry_1.initSentry)();
async function bootstrap() {
    logger_1.logger.info(`Bootstrap started, elapsed ${Date.now() - _startTime}ms`);
    logger_1.logger.info(`Bot deployed at ${new Date().toISOString()}, version ${package_json_1.default.version}`);
    logger_1.logger.info("Bootstrapping Bot Ecosystem...");
    if (!config_1.CONFIG.TELEGRAM_TOKEN) {
        logger_1.logger.error('TELEGRAM_BOT_TOKEN must be set in environment variables!');
        process.exit(1);
    }
    if (!config_1.CONFIG.DASHBOARD_SECRET) {
        logger_1.logger.error('DASHBOARD_SECRET environment variable is REQUIRED!');
        process.exit(1);
    }
    try {
        const { SecretManager } = await Promise.resolve().then(() => __importStar(require("./services/secret_manager")));
        await SecretManager.init();
        logger_1.logger.info(`Secret backend: ${SecretManager.getBackend()}`);
        const { initI18n } = await Promise.resolve().then(() => __importStar(require("./services/i18n")));
        const { refreshKeyPool, getActiveKeyStats } = await Promise.resolve().then(() => __importStar(require("./services/ai")));
        const { getEnvKeySourceReport } = await Promise.resolve().then(() => __importStar(require("./config/config")));
        await initI18n();
        await refreshKeyPool();
        const keyStats = getActiveKeyStats();
        logger_1.logger.info(`AI KeyPool: ${keyStats.total} keys loaded`, { byProvider: keyStats.byProvider, envVars: getEnvKeySourceReport() });
        if (keyStats.total === 0)
            logger_1.logger.warn('AI KEY POOL IS EMPTY! Check Render .env vars.');
        try {
            const ytDlpBinary = await (0, ytdlp_1.resolveYtDlpPath)();
            if (ytDlpBinary)
                logger_1.logger.info(`yt-dlp found: ${ytDlpBinary}`);
            else
                logger_1.logger.warn('yt-dlp not found. Downloads will use Cobalt API.');
        }
        catch (e) {
            logger_1.logger.warn(`yt-dlp check error: ${e.message}`);
        }
        const PORT = parseInt(process.env.PORT || '3000', 10);
        (0, dashboard_1.startDashboardServer)(PORT, telegram_1.bot);
        await (0, telegram_1.startBot)();
        await (0, jobs_1.startWorkers)();
        const { SchedulerService } = await Promise.resolve().then(() => __importStar(require('./services/scheduler')));
        SchedulerService.setup();
        (0, rss_cron_1.setupRSSCron)();
        (0, jobs_1.setupSystemCrons)();
        const { setupHealthMonitoring } = await Promise.resolve().then(() => __importStar(require('./services/health_monitor')));
        setupHealthMonitoring();
        if (config_1.CONFIG.OWNER_ID) {
            telegram_1.bot.sendMessage(config_1.CONFIG.OWNER_ID, `✅ Bot started\nVersion: ${package_json_1.default.version}\nUptime: ${Math.round(process.uptime())}s`).catch(() => { });
        }
    }
    catch (err) {
        (0, sentry_1.captureError)(err, { type: 'bootstrap' });
        logger_1.logger.error(`Fatal Initialization Error: ${err.message}`, { stack: err.stack });
        process.exit(1);
    }
}
bootstrap().catch(err => {
    logger_1.logger.error(`🔥 Fatal Bootstrap Error: ${err.message}`);
    process.exit(1);
});
// Global error handlers
process.on("uncaughtException", (err) => {
    (0, sentry_1.captureError)(err, { type: 'uncaughtException' });
    logger_1.logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    (0, sentry_1.captureError)(reason instanceof Error ? reason : new Error(String(reason)), { type: 'unhandledRejection' });
    logger_1.logger.error(`Unhandled Rejection: ${reason?.message || reason}`);
});
let shuttingDown = false;
process.on('SIGTERM', async () => {
    if (shuttingDown)
        return;
    shuttingDown = true;
    logger_1.logger.info('SIGTERM received, shutting down gracefully');
    try {
        telegram_1.bot.stopPolling();
        const { gracefulShutdown } = await Promise.resolve().then(() => __importStar(require('./services/memory_queue')));
        await gracefulShutdown(8000);
    }
    catch {
        logger_1.logger.warn(`SIGTERM shutdown error`);
    }
    process.exit(0);
});
process.on('SIGINT', async () => {
    if (shuttingDown)
        return;
    shuttingDown = true;
    logger_1.logger.info('SIGINT received, shutting down gracefully');
    try {
        telegram_1.bot.stopPolling();
        const { gracefulShutdown } = await Promise.resolve().then(() => __importStar(require('./services/memory_queue')));
        await gracefulShutdown(5000);
    }
    catch {
        logger_1.logger.warn(`SIGINT shutdown error`);
    }
    process.exit(0);
});
