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
    // 4. Start Post Scheduler
    const { SchedulerService } = await Promise.resolve().then(() => __importStar(require('./services/scheduler')));
    SchedulerService.setup();
    // 4. Setup Cron Jobs
    (0, rss_cron_1.setupRSSCron)();
    // Setup other crons
    setupSystemCrons();
    logger_1.logger.info("✅ Ecosystem is up and running!");
}
function setupSystemCrons() {
    // 1. Self-ping to keep Render service alive
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
    // 2. Price Tracker Cron (Every 4 hours)
    node_cron_1.default.schedule('0 */4 * * *', async () => {
        try {
            const { PriceTrackerService } = await Promise.resolve().then(() => __importStar(require('./services/pricetracker')));
            await PriceTrackerService.runPriceChecks();
        }
        catch (err) {
            logger_1.logger.error(`❌ Price Tracker Cron Error: ${err.message}`);
        }
    });
    // 3. Daily Digest Cron (Every minute, check who needs digest)
    node_cron_1.default.schedule('* * * * *', async () => {
        try {
            const { processDailyDigests } = await Promise.resolve().then(() => __importStar(require('./crons/digest_cron')));
            await processDailyDigests();
        }
        catch (err) {
            // Ignore if file doesn't exist yet, we will create it
        }
    });
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
