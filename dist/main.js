"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config/config");
const logger_1 = require("./utils/logger");
const telegram_1 = require("./services/telegram");
const dashboard_1 = require("./services/dashboard");
const workers_1 = require("./workers");
const rss_cron_1 = require("./crons/rss_cron");
const node_cron_1 = __importDefault(require("node-cron"));
const axios_1 = __importDefault(require("axios"));
async function bootstrap() {
    logger_1.logger.info("🚀 Bootstrapping Newsroom Bot Ecosystem...");
    // 1. Start Dashboard
    const PORT = process.env.PORT || 3000;
    (0, dashboard_1.startDashboardServer)(PORT, telegram_1.bot);
    // 2. Start Bot
    await (0, telegram_1.startBot)();
    // 3. Start Background Workers
    (0, workers_1.startWorkers)();
    // 4. Setup Cron Jobs
    (0, rss_cron_1.setupRSSCron)();
    // Setup other crons
    setupSystemCrons();
    logger_1.logger.info("✅ Ecosystem is up and running!");
}
function setupSystemCrons() {
    // Self-ping to keep service alive
    node_cron_1.default.schedule('*/10 * * * *', async () => {
        if (!config_1.CONFIG.PUBLIC_URL)
            return;
        try {
            await axios_1.default.get(config_1.CONFIG.PUBLIC_URL, { timeout: 10000 });
            logger_1.logger.info(`🌐 Self-ping successful`);
        }
        catch (err) {
            logger_1.logger.warn(`🌐 Self-ping failed: ${err.message}`);
        }
    });
    // Add more system crons here (e.g. daily reports, price checks)
}
bootstrap().catch(err => {
    logger_1.logger.error(`🔥 Fatal Bootstrap Error: ${err.message}`);
    process.exit(1);
});
// Global error handlers
process.on("uncaughtException", (err) => {
    logger_1.logger.error(`🔥 Uncaught Exception: ${err.message}`);
    logger_1.logger.error(err.stack || "");
});
process.on("unhandledRejection", (reason) => {
    logger_1.logger.error(`🌐 Unhandled Rejection: ${reason?.message || reason}`);
});
