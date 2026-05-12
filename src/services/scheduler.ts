import cron from 'node-cron';
import { DBService } from './database';
import { bot } from './bot_instance';
import { logger } from '../utils/logger';
import { YoutubeService } from './youtube';

export const SchedulerService = {
  setup() {
    // Check every minute for scheduled posts
    cron.schedule('* * * * *', async () => {
      await this.processScheduledPosts();
    });
    logger.info('📅 Scheduler Service initialized (checking every minute)');
  },

  async processScheduledPosts() {
    const posts = await DBService.getPendingScheduledPosts();
    if (posts.length === 0) return;

    logger.info(`📅 Processing ${posts.length} scheduled posts...`);

    for (const post of posts) {
      try {
        const user = await DBService.getUser(post.user_id);
        if (!user || !user.target_channel) {
          logger.warn(`Skip post ${post.id}: user ${post.user_id} has no target channel`);
          continue;
        }

        const content = post.content;
        
        if (post.type === 'video' && content.url) {
           await bot.sendVideo(user.target_channel, content.url, { caption: content.caption, parse_mode: 'HTML' });
        } else if (post.type === 'audio' && content.url) {
           await bot.sendAudio(user.target_channel, content.url, { caption: content.caption, parse_mode: 'HTML' });
        } else if (post.type === 'text') {
           await bot.sendMessage(user.target_channel, content.text, { parse_mode: 'HTML' });
        }

        await DBService.markScheduledPostSent(post.id);
        logger.info(`✅ Scheduled post ${post.id} sent to ${user.target_channel}`);
      } catch (err: any) {
        logger.error(`❌ Failed to send scheduled post ${post.id}: ${err.message}`);
      }
    }
  }
};
