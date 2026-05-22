import { bot } from "./bot_instance";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import { processArticleInline } from "../workers/scraper_worker";
import { logger, sanitizeLogInput } from "../utils/logger";

export const RssService = {
  async pruneCache(activeIds: Set<number>) {
    for (const id of userLastRun.keys()) {
      if (!activeIds.has(id)) userLastRun.delete(id);
    }
  },

  async checkMonitoredChannels() {
    try {
      const channels = await DBService.getMonitoredChannels();
      for (const channel of channels) {
        let latestPost: any = null;
        if (channel.platform === 'youtube') {
          const { YoutubeService } = await import('../services/youtube');
          latestPost = await YoutubeService.getLatestVideo(channel.channel_id);
        } else if (channel.platform === 'instagram') {
          const { InstagramService } = await import('../services/instagram');
          latestPost = await InstagramService.getLatestPost(channel.channel_id);
        }

        if (latestPost && latestPost.id !== channel.last_post_id) {
          logger.info(`New post found on ${sanitizeLogInput(channel.platform)} channel ${sanitizeLogInput(channel.name)}`);
          const user = await DBService.getUser(channel.user_id);
          if (user && user.target_channel) {
            const caption = `📢 <b>Yangi ${channel.platform} xabari!</b>\n\n${latestPost.title}\n\n🔗 <a href="${latestPost.url}">Ko'rish</a>`;
            try {
              await bot.sendMessage(user.target_channel, caption, { parse_mode: 'HTML' });
            } catch (e: any) {
              logger.warn(`Failed to send monitored channel update: ${e.message}`);
              try {
                const errMsg = `⚠️ <b>Kanalga post yuborib bo'lmadi!</b>\n\nBot <code>${user.target_channel}</code> kanalida administrator emas yoki xabar yuborish huquqi yo'q. Iltimos, botni kanalga admin qilib qo'shing.\n\nPost: ${latestPost.title}`;
                await bot.sendMessage(channel.user_id, errMsg, { parse_mode: 'HTML' });
              } catch (alertErr: any) {
                logger.error(`Failed to alert user ${channel.user_id} about channel permissions: ${alertErr.message}`);
              }
            }
          }
          await DBService.updateMonitoredChannel(channel.id, latestPost.id);
        }
      }
    } catch (err: any) {
      logger.error(`checkMonitoredChannels error: ${err.message}`);
    }
  },

  async processDirectly(userId: number, source: any): Promise<void> {
    try {
      const articles: any[] = await ScraperService.fetchRSS(source.url);
      articles.sort((a: any, b: any) => {
        const left = new Date(b?.pubDate || 0).getTime();
        const right = new Date(a?.pubDate || 0).getTime();
        return left - right;
      });
      const lang = source.lang || 'uz';

      for (const article of articles) {
        try {
          const locked = DBService.acquireRecentNewsLock(userId, article.link, article.title);
          if (!locked) continue;

          const isDuplicate = await DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
          if (isDuplicate) continue;

          logger.info(`[direct] New article: ${sanitizeLogInput(article.title)}`);

          const articleData = {
            title: article.title,
            url: article.link,
            source: source.name,
            content: article.contentSnippet || article.content || '',
            imageUrl: article.imageUrl || null,
            pubDate: article.pubDate,
          };

          try {
            await processArticleInline(userId, articleData, lang);
            await DBService.markSeen(userId, article.link, article.title);
          } catch (articleErr: any) {
            logger.error(`Error inline processing article ${sanitizeLogInput(article.link)}: ${articleErr.message}`);
          }
        } catch (articleErr: any) {
          logger.error(`Error handling article ${sanitizeLogInput(article.link)}: ${articleErr.message}`);
        }
      }
    } catch (err: any) {
      logger.warn(`Direct RSS process error for ${sanitizeLogInput(source.url)}: ${err.message}`);
    }
  },
};

const userLastRun = new Map<number, number>();
