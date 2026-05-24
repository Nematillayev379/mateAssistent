import { Worker, Job } from "bullmq";
import { CONFIG } from "../config/config";
import { ScraperService } from "../services/scraper";
import { DBService } from "../services/database";
import { getRedisOptions } from "../services/redis";
import { getSmartAIResponse, moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } from "../services/ai";
import { safeSend } from "../services/sender";
import { logger, sanitizeLogInput } from "../utils/logger";
import crypto from "crypto";

const lowerAdKeywords = (CONFIG.AD_KEYWORDS || []).map((k) => k.toLowerCase());
const connectionOptions = getRedisOptions();

if (!connectionOptions) {
  logger.warn("scraper_worker: no Redis connection options, worker not started");
} else {
  const scraperWorker = new Worker(
    "scraper-queue",
    async (job: Job) => {
      const { userId, sourceUrl, sourceName, lang } = job.data;

      try {
        logger.info(`Job ${job.id}: Scraping ${sanitizeLogInput(sourceUrl)} for user ${userId}`);
        const articles: any[] = await ScraperService.fetchRSS(sourceUrl);
        articles.sort((a: any, b: any) => new Date(b?.pubDate || 0).getTime() - new Date(a?.pubDate || 0).getTime());

        for (const article of articles) {
          const locked = DBService.acquireRecentNewsLock(userId, article.link, article.title);
          if (!locked) {
            await DBService.incrementStat(userId, "total_duplicates");
            continue;
          }

          const isDuplicate = await DBService.isSeenOrSeenByTitle(userId, article.link, article.title);
          if (isDuplicate) {
            await DBService.incrementStat(userId, "total_duplicates");
            continue;
          }

          await processArticleInline(userId, {
            title: article.title,
            url: article.link,
            source: sourceName,
            content: article.contentSnippet || article.content || "",
            imageUrl: article.imageUrl || null,
            pubDate: article.pubDate,
          }, lang);
        }
      } catch (error) {
        logger.error(`Scraper Worker Error: ${error}`);
        throw error;
      }
    },
    { connection: connectionOptions }
  );

  scraperWorker.on("error", (err) => {
    if (err.message.includes("limit exceeded") || err.message.toLowerCase().includes("exceeded")) {
      logger.warn(`Scraper worker: limit exceeded (pool rotating automatically)`);
    } else {
      logger.error(`Scraper worker error: ${err.message}`);
    }
  });

  logger.info("Scraper Worker started with Redis connection options");
}

export async function processArticleInline(userId: number, article: any, sourceLang: string): Promise<void> {
  try {
    const user = await DBService.getUser(userId);
    if (!user || !user.target_channel || user.is_active === 0) return;

    const intervalMinutes = Math.max(Number(user.interval_minutes) || 15, 1);
    if (!DBService.tryReserveUserSendSlot(userId, intervalMinutes)) {
      logger.info(`Skip inline send for user ${userId}: interval cooldown active`);
      return;
    }

    const textToScan = `${article.title || ""} ${article.content || ""}`.toLowerCase();
    if (lowerAdKeywords.some((k) => textToScan.includes(k))) {
      DBService.releaseUserSendSlot(userId);
      return;
    }

    if (((article.content || "").length < 200 || !article.imageUrl) && article.url) {
      try {
        const full = await ScraperService.scrapeArticle(article.url);
        if (full?.content) article.content = full.content;
        if (!article.imageUrl && full?.imageUrl) article.imageUrl = full.imageUrl;
      } catch { logger.warn(`ScrapeArticle fallback failed`); }
    }

    const moderation = await moderateContent(article.title, article.content || "");
    if (moderation.status === "BLOCKED") {
      DBService.releaseUserSendSlot(userId);
      return;
    }

    const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content || "");
    if (isSemanticDup) {
      DBService.releaseUserSendSlot(userId);
      return;
    }

    const userLang = user.language || sourceLang || "uz";
    const langMap: Record<string, string> = { uz: "O'zbek", ru: "Russian", en: "English", tr: "Turkish" };
    const fullLangName = langMap[userLang] || userLang;

    const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Response MUST be in ${fullLangName}.`;
    const userPrompt = `Title: ${article.title}\nContent: ${article.content || ""}`;

    const summary = await getSmartAIResponse(systemPrompt, userPrompt);
    if (!summary || summary.length < 10) {
      DBService.releaseUserSendSlot(userId);
      return;
    }

    const category = await categorizeNews(article.title, summary);
    const emoji = await getNiceEmoji(article.title);

    await safeSend(user, {
      ...article,
      content: summary,
      emoji: emoji || "🔹",
      category,
      source: article.source || "mateAssistent",
    });
  } catch (err: any) {
    DBService.releaseUserSendSlot(userId);
    logger.error(`Inline article processing error for user ${userId}: ${err.message}`);
    throw err;
  }
}

export {};
