import cron from 'node-cron';
import { DBService } from './database';
import { bot } from './bot_instance';
import { logger } from '../utils/logger';

export const SchedulerService = {
  setup() {
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
          await DBService.updateScheduledPostStatus(post.id, 'failed').catch((e: any) => logger.warn(`Scheduler status update failed: ${e.message}`));
          continue;
        }
        let content = post.content;
        if (typeof content === 'string') {
          try { content = JSON.parse(content); } catch {
            content = { text: content };
          }
        }

        const { safeSend } = await import('./telegram');
        
        // Convert scheduled post to article format for safeSend
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
        await DBService.markScheduledPostSent(post.id);
        logger.info(`✅ Scheduled post ${post.id} sent to ${user.target_channel}`);
      } catch (err: any) {
        logger.error(`❌ Failed to send scheduled post ${post.id}: ${err.message}`);
        await DBService.updateScheduledPostStatus(post.id, 'failed').catch((e: any) => logger.warn(`Scheduler status update failed: ${e.message}`));
      }
    }
  }
};
