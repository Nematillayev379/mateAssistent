import cron from 'node-cron';
import { DBService } from './database';
import { bot } from './bot_instance';
import { logger } from '../utils/logger';
import { CONFIG } from '../config/config';

let schedulerInitialized = false;

export const SchedulerService = {
  setup() {
    if (schedulerInitialized) {
      logger.warn('SchedulerService.setup called more than once; skipping duplicate cron registration.');
      return;
    }

    cron.schedule('* * * * *', async () => {
      try {
        await this.processScheduledPosts();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Scheduler loop failed: ${msg}`);
      }
    }, { timezone: CONFIG.TIMEZONE });

    schedulerInitialized = true;
    logger.info('Scheduler Service initialized (checking every minute)');
  },

  async processScheduledPosts() {
    const posts = await DBService.getPendingScheduledPosts();
    if (posts.length === 0) return;

    logger.info(`Processing ${posts.length} scheduled posts...`);

    for (const post of posts) {
      try {
        const user = await DBService.getUser(post.user_id);
        if (!user || !user.target_channel) {
          logger.warn(`Skip post ${post.id}: user ${post.user_id} has no target channel`);
          await DBService.updateScheduledPostStatus(post.id, 'failed').catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`Scheduler status update failed: ${msg}`);
          });
          continue;
        }

        let content = post.content;
        if (typeof content === 'string') {
          try {
            content = JSON.parse(content);
          } catch {
            content = { text: content };
          }
        }

        const { safeSend } = await import('./sender');
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
        logger.info(`Scheduled post ${post.id} sent to ${user.target_channel}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to send scheduled post ${post.id}: ${msg}`);
        await DBService.updateScheduledPostStatus(post.id, 'failed').catch((e: unknown) => {
          const m = e instanceof Error ? e.message : String(e);
          logger.warn(`Scheduler status update failed: ${m}`);
        });
      }
    }
  }
};
