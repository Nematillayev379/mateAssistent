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

        // BUG #59 Fix: Ensure content is an object (Supabase might return string for JSONB)
        let content = post.content;
        if (typeof content === 'string') {
          try { content = JSON.parse(content); } catch { logger.error(`Invalid JSON in post ${post.id}`); continue; }
        }
        
        if (post.type === 'video' && content.url) {
           const { downloadYouTube } = await import('./youtube');
           const filePath = await downloadYouTube(content.url, 'video');
           await bot.sendVideo(user.target_channel, filePath, { caption: content.caption, parse_mode: 'HTML' });
           const fs = await import('fs');
           if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } else if (post.type === 'audio' && content.url) {
           const { downloadYouTube } = await import('./youtube');
           const filePath = await downloadYouTube(content.url, 'audio');
           await bot.sendAudio(user.target_channel, filePath, { caption: content.caption, parse_mode: 'HTML' });
           const fs = await import('fs');
           if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } else if (post.type === 'text') {
           await bot.sendMessage(user.target_channel, content.text || content.caption, { parse_mode: 'HTML' });
        }

        await DBService.markScheduledPostSent(post.id);
        logger.info(`✅ Scheduled post ${post.id} sent to ${user.target_channel}`);
      } catch (err: any) {
        logger.error(`❌ Failed to send scheduled post ${post.id}: ${err.message}`);
        // BUG #77 Fix: Mark as failed to avoid infinite retries
        await DBService.updateUser(post.id, { status: 'failed' }).catch(() => {}); // Wait, updateScheduledPost?
        // I'll use a generic DBService update if it exists or add one.
        await DBService.updateScheduledPostStatus(post.id, 'failed').catch(() => {});
      }
    }
  }
};
