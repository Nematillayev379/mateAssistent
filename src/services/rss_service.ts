import { bot } from "./bot_instance";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import { processArticleInline } from "../jobs/scraper_worker";
import { logger, sanitizeLogInput } from "../utils/logger";

interface MonitoredPost {
  id: string;
  title: string;
  url?: string;
}

interface RssSource {
  url: string;
  name: string;
  lang?: string;
}

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
        let latestPost: MonitoredPost | null = null;
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
            } catch (e: unknown) {
              logger.warn(`Failed to send monitored channel update: ${e instanceof Error ? e.message : String(e)}`);
              try {
                const errMsg = `⚠️ <b>Kanalga post yuborib bo'lmadi!</b>\n\nBot <code>${user.target_channel}</code> kanalida administrator emas yoki xabar yuborish huquqi yo'q. Iltimos, botni kanalga admin qilib qo'shing.\n\nPost: ${latestPost.title}`;
                await bot.sendMessage(channel.user_id, errMsg, { parse_mode: 'HTML' });
              } catch (alertErr: unknown) {
                logger.error(`Failed to alert user ${channel.user_id} about channel permissions: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`);
              }
            }
          }
          await DBService.updateMonitoredChannel(channel.id, latestPost.id);
        }
      }
    } catch (err: unknown) {
      logger.error(`checkMonitoredChannels error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  async processDirectly(userId: number, source: RssSource): Promise<void> {
    try {
      const articles = await ScraperService.fetchRSS(source.url);
      articles.sort((a, b) => {
        const left = new Date(b?.pubDate || 0).getTime();
        const right = new Date(a?.pubDate || 0).getTime();
        return left - right;
      });
      const lang = source.lang || 'uz';

      for (const article of articles) {
        try {
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
            await DBService.markSeen(userId, article.link, article.title);
            await processArticleInline(userId, articleData, lang);
          } catch (articleErr: unknown) {
            logger.error(`Error inline processing article ${sanitizeLogInput(article.link)}: ${articleErr instanceof Error ? articleErr.message : String(articleErr)}`);
          }
        } catch (articleErr: unknown) {
          logger.error(`Error handling article ${sanitizeLogInput(article.link)}: ${articleErr instanceof Error ? articleErr.message : String(articleErr)}`);
        }
      }
    } catch (err: unknown) {
      logger.warn(`Direct RSS process error for ${sanitizeLogInput(source.url)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

const userLastRun = new Map<number, number>();
