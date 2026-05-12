"use strict";
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
        // Check every minute for scheduled posts
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
                const content = post.content;
                if (post.type === 'video' && content.url) {
                    await bot_instance_1.bot.sendVideo(user.target_channel, content.url, { caption: content.caption, parse_mode: 'HTML' });
                }
                else if (post.type === 'audio' && content.url) {
                    await bot_instance_1.bot.sendAudio(user.target_channel, content.url, { caption: content.caption, parse_mode: 'HTML' });
                }
                else if (post.type === 'text') {
                    await bot_instance_1.bot.sendMessage(user.target_channel, content.text, { parse_mode: 'HTML' });
                }
                await database_1.DBService.markScheduledPostSent(post.id);
                logger_1.logger.info(`✅ Scheduled post ${post.id} sent to ${user.target_channel}`);
            }
            catch (err) {
                logger_1.logger.error(`❌ Failed to send scheduled post ${post.id}: ${err.message}`);
            }
        }
    }
};
