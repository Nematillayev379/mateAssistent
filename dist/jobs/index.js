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
exports.startWorkers = startWorkers;
exports.setupSystemCrons = setupSystemCrons;
const node_cron_1 = __importDefault(require("node-cron"));
const axios_1 = __importDefault(require("axios"));
const queue_1 = require("../services/queue");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
async function startWorkers() {
    if (!(0, queue_1.isRedisAvailable)()) {
        logger_1.logger.info('No Redis — using inline processing (memory queue)');
        return;
    }
    try {
        await Promise.resolve().then(() => __importStar(require('./scraper_worker')));
        logger_1.logger.info('Scraper worker started (AI processing runs inline)');
    }
    catch (err) {
        logger_1.logger.warn(`Workers failed to start: ${err.message} — falling back to inline processing`);
    }
}
function setupSystemCrons() {
    scheduleSelfPing();
    scheduleDailyDigest();
    scheduleCleanup();
    scheduleClusterDigest();
    scheduleWorkspaceRebalance();
    scheduleKeyPoolRefresh();
    scheduleDailyRssSearch();
}
function scheduleSelfPing() {
    if (!config_1.CONFIG.PUBLIC_URL) {
        logger_1.logger.warn('Self-ping skipped: PUBLIC_URL not set');
        return;
    }
    node_cron_1.default.schedule("*/10 * * * *", async () => {
        try {
            await axios_1.default.get(config_1.CONFIG.PUBLIC_URL, { timeout: 10000 });
            logger_1.logger.debug('Self-ping OK');
        }
        catch (e) {
            logger_1.logger.warn(`Self-ping failed: ${e?.message || 'unknown error'}`);
        }
    });
    logger_1.logger.info(`Self-ping scheduled every 10 min → ${config_1.CONFIG.PUBLIC_URL}`);
}
function scheduleDailyRssSearch() {
    node_cron_1.default.schedule("0 8 * * *", async () => {
        try {
            const { RssSearchService } = await Promise.resolve().then(() => __importStar(require("../services/rss_search")));
            const { DBService } = await Promise.resolve().then(() => __importStar(require("../services/database")));
            const { bot } = await Promise.resolve().then(() => __importStar(require("../services/bot_instance")));
            const users = await DBService.getActiveUsers();
            for (const user of users) {
                const searches = await RssSearchService.getUserSearches(user.telegram_id);
                const dailySearches = searches.filter(s => s.mode === 'daily' && s.isActive);
                for (const search of dailySearches) {
                    try {
                        const results = await RssSearchService.runSearch(search.id);
                        if (results.length > 0) {
                            const summary = await RssSearchService.summarizeResults(results, search.topic, user.language || 'uz');
                            await bot.sendMessage(user.target_channel || user.telegram_id, summary, { parse_mode: 'HTML' }).catch(() => { });
                        }
                    }
                    catch (e) {
                        logger_1.logger.warn(`Daily RSS search failed for ${user.telegram_id}: ${e.message}`);
                    }
                    await new Promise(r => setTimeout(r, 500));
                }
            }
            logger_1.logger.info('Daily RSS search completed');
        }
        catch (err) {
            logger_1.logger.error(`Daily RSS Search Cron Error: ${err.message}`);
        }
    });
}
function scheduleDailyDigest() {
    node_cron_1.default.schedule("*/15 * * * *", async () => {
        try {
            const { processDailyDigests } = await Promise.resolve().then(() => __importStar(require("./digest_cron")));
            await processDailyDigests();
        }
        catch (err) {
            logger_1.logger.warn(`Daily digest cron: ${err.message}`);
        }
    });
}
function scheduleCleanup() {
    node_cron_1.default.schedule("0 */6 * * *", async () => {
        try {
            const { DownloaderService } = await Promise.resolve().then(() => __importStar(require("../services/downloader")));
            const { MusicService } = await Promise.resolve().then(() => __importStar(require("../services/music")));
            const { DBService } = await Promise.resolve().then(() => __importStar(require("../services/database")));
            await DownloaderService.cleanup();
            await MusicService.cleanup();
            await DBService.cleanupOldEmbeddings(7);
            await DBService.cleanupExpiredPremium();
            logger_1.logger.info("System cleanup completed");
        }
        catch (err) {
            logger_1.logger.error(`System Cleanup Error: ${err.message}`);
        }
    });
}
function scheduleClusterDigest() {
    node_cron_1.default.schedule("0 */4 * * *", async () => {
        try {
            const { ClusteringService } = await Promise.resolve().then(() => __importStar(require("../services/clustering")));
            const { DBService } = await Promise.resolve().then(() => __importStar(require("../services/database")));
            const activeUsers = await DBService.getActiveUsers();
            for (const u of activeUsers) {
                if (u.target_channel) {
                    await ClusteringService.sendClusterDigest(u.telegram_id, u.target_channel);
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }
        catch (err) {
            logger_1.logger.error(`Cluster digest cron: ${err.message}`);
        }
    });
}
function scheduleWorkspaceRebalance() {
    node_cron_1.default.schedule("0 */6 * * *", async () => {
        try {
            const { WorkspaceService } = await Promise.resolve().then(() => __importStar(require("../services/workspace")));
            const { DBService } = await Promise.resolve().then(() => __importStar(require("../services/database")));
            const users = await DBService.getActiveUsers();
            for (const u of users) {
                const workspaces = await DBService.getUserWorkspaces(u.telegram_id);
                for (const ws of workspaces) {
                    await WorkspaceService.rebalanceContent(ws.id);
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }
        catch (err) {
            logger_1.logger.error(`Workspace rebalance cron: ${err.message}`);
        }
    });
}
function scheduleKeyPoolRefresh() {
    node_cron_1.default.schedule("0 * * * *", async () => {
        try {
            const { refreshKeyPool } = await Promise.resolve().then(() => __importStar(require("../services/ai")));
            await refreshKeyPool();
        }
        catch (err) {
            logger_1.logger.error(`Key Pool Refresh Error: ${err.message}`);
        }
    });
}
