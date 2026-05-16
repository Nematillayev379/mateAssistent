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
const bot_instance_1 = require("./bot_instance");
const logger_1 = require("../utils/logger");
exports.SchedulerService = {
    setup() {
        // BUG-118 Fix: Use arrow function to preserve 'this' context
        node_cron_1.default.schedule('* * * * *', async () => {
            await this.processScheduledPosts();
        });
        logger_1.logger.info('📅 Scheduler Service initialized (checking every minute)');
    },
    async processScheduledPosts() {
        const posts = await database_1.DBService.getPendingScheduledPosts();
        if (posts.length === 0)
            return;
        logger_1.logger.info(`📅 Processing ${posts.length} scheduled posts...`);
        for (const post of posts) {
            try {
                const user = await database_1.DBService.getUser(post.user_id);
                if (!user || !user.target_channel) {
                    logger_1.logger.warn(`Skip post ${post.id}: user ${post.user_id} has no target channel`);
                    continue;
                }
                // BUG-116 Fix: Ensure content is an object and has url
                let content = post.content;
                if (typeof content === 'string') {
                    try {
                        content = JSON.parse(content);
                    }
                    catch {
                        logger_1.logger.error(`Invalid JSON in post ${post.id}`);
                        continue;
                    }
                }
                // BUG-116 Fix: Check content.url before download
                if (post.type === 'video' && content?.url) {
                    const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('./youtube')));
                    const filePath = await downloadYouTube(content.url, 'video');
                    await bot_instance_1.bot.sendVideo(user.target_channel, filePath, { caption: content.caption, parse_mode: 'HTML' });
                    // BUG-115 Fix: Always cleanup temp file
                    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                    try {
                        if (fs.existsSync(filePath))
                            fs.unlinkSync(filePath);
                    }
                    catch { }
                }
                else if (post.type === 'audio' && content?.url) {
                    const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('./youtube')));
                    const filePath = await downloadYouTube(content.url, 'audio');
                    await bot_instance_1.bot.sendAudio(user.target_channel, filePath, { caption: content.caption, parse_mode: 'HTML' });
                    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
                    try {
                        if (fs.existsSync(filePath))
                            fs.unlinkSync(filePath);
                    }
                    catch { }
                }
                else if (post.type === 'text') {
                    await bot_instance_1.bot.sendMessage(user.target_channel, content.text || content.caption, { parse_mode: 'HTML' });
                }
                await database_1.DBService.markScheduledPostSent(post.id);
                logger_1.logger.info(`✅ Scheduled post ${post.id} sent to ${user.target_channel}`);
            }
            catch (err) {
                logger_1.logger.error(`❌ Failed to send scheduled post ${post.id}: ${err.message}`);
                // BUG-117 Fix: Use updateScheduledPostStatus instead of updateUser
                await database_1.DBService.updateScheduledPostStatus(post.id, 'failed').catch(() => { });
            }
        }
    }
};
