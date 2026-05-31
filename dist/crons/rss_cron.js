"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupRSSCron = setupRSSCron;
const node_cron_1 = __importDefault(require("node-cron"));
const database_1 = require("../services/database");
const queue_1 = require("../services/queue");
const rss_service_1 = require("../services/rss_service");
const logger_1 = require("../utils/logger");
const userLastRun = new Map();
let lastMonitoredCheck = 0;
const MONITORED_CHECK_INTERVAL = 5 * 60 * 1000;
function setupRSSCron() {
    node_cron_1.default.schedule('0 0 * * *', async () => {
        try {
            const activeUsers = await database_1.DBService.getActiveUsers();
            const activeIds = new Set(activeUsers.map(u => u.telegram_id));
            await rss_service_1.RssService.pruneCache(activeIds);
            logger_1.logger.info('Memory cleanup: userLastRun cache pruned');
        }
        catch (err) {
            logger_1.logger.error(`Memory cleanup cron failed: ${err.message}`);
        }
    });
    node_cron_1.default.schedule('*/2 * * * *', async () => {
        try {
            const users = await database_1.DBService.getActiveUsers();
            const now = Date.now();
            if (now - lastMonitoredCheck > MONITORED_CHECK_INTERVAL) {
                lastMonitoredCheck = now;
                await rss_service_1.RssService.checkMonitoredChannels().catch(err => logger_1.logger.error(`checkMonitoredChannels: ${err.message}`));
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
                    const times = user.schedule_times.split(',').map((t) => {
                        const match = t.trim().match(/^(\d{1,2})[:.](\d{2})/);
                        if (!match)
                            return null;
                        const h = parseInt(match[1]);
                        const m = parseInt(match[2]);
                        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    }).filter(Boolean);
                    if (!times.includes(currentTime))
                        continue;
                    if (nowMs - lastRun < 65000)
                        continue;
                }
                else if (nowMs - lastRun < intervalMs) {
                    continue;
                }
                userLastRun.set(user.telegram_id, nowMs);
                const sources = await database_1.DBService.getUserSources(user.telegram_id);
                if (!sources || sources.length === 0)
                    continue;
                logger_1.logger.info(`RSS cron: processing ${sources.length} sources for user ${user.telegram_id}`);
                for (const source of sources) {
                    const queued = (0, queue_1.isRedisAvailable)() && await (0, queue_1.addScraperJob)({
                        userId: user.telegram_id,
                        sourceUrl: source.url,
                        sourceName: source.name,
                        lang: source.lang || 'uz',
                    });
                    if (!queued) {
                        await rss_service_1.RssService.processDirectly(user.telegram_id, source);
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`RSS Cron Error: ${error}`);
        }
    });
    logger_1.logger.info('RSS cron scheduled (every 2 min, respects user intervals)');
}
