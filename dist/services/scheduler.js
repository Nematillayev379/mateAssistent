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
exports.SchedulerService = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const database_1 = require("./database");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
let schedulerInitialized = false;
exports.SchedulerService = {
    setup() {
        if (schedulerInitialized) {
            logger_1.logger.warn('SchedulerService.setup called more than once; skipping duplicate cron registration.');
            return;
        }
        node_cron_1.default.schedule('* * * * *', async () => {
            try {
                await this.processScheduledPosts();
            }
            catch (err) {
                logger_1.logger.error(`Scheduler loop failed: ${err.message}`);
            }
        }, { timezone: config_1.CONFIG.TIMEZONE });
        schedulerInitialized = true;
        logger_1.logger.info('Scheduler Service initialized (checking every minute)');
    },
    async processScheduledPosts() {
        const posts = await database_1.DBService.getPendingScheduledPosts();
        if (posts.length === 0)
            return;
        logger_1.logger.info(`Processing ${posts.length} scheduled posts...`);
        for (const post of posts) {
            try {
                const user = await database_1.DBService.getUser(post.user_id);
                if (!user || !user.target_channel) {
                    logger_1.logger.warn(`Skip post ${post.id}: user ${post.user_id} has no target channel`);
                    await database_1.DBService.updateScheduledPostStatus(post.id, 'failed').catch((e) => logger_1.logger.warn(`Scheduler status update failed: ${e.message}`));
                    continue;
                }
                let content = post.content;
                if (typeof content === 'string') {
                    try {
                        content = JSON.parse(content);
                    }
                    catch {
                        content = { text: content };
                    }
                }
                const { safeSend } = await Promise.resolve().then(() => __importStar(require('./sender')));
                const article = {
                    title: content.title || (post.type === 'text' ? 'Xabar' : 'Media'),
                    content: content.text || content.caption || '',
                    url: content.url || '',
                    videoUrl: post.type === 'video' ? content.url : null,
                    audioUrl: post.type === 'audio' ? content.url : null,
                    emoji: post.type === 'text' ? '📝' : (post.type === 'video' ? '📹' : '🎵'),
                    source: 'Scheduled'
                };
                await safeSend(user, article);
                await database_1.DBService.markScheduledPostSent(post.id);
                logger_1.logger.info(`Scheduled post ${post.id} sent to ${user.target_channel}`);
            }
            catch (err) {
                logger_1.logger.error(`Failed to send scheduled post ${post.id}: ${err.message}`);
                await database_1.DBService.updateScheduledPostStatus(post.id, 'failed').catch((e) => logger_1.logger.warn(`Scheduler status update failed: ${e.message}`));
            }
        }
    }
};
