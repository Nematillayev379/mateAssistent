import { Worker, Job } from "bullmq";
import { getRedisOptions } from "../services/redis";
import { CONFIG } from "../config/config";
import { getSmartAIResponse, moderateContent, checkSemanticDuplicate, categorizeNews, getNiceEmoji } from "../services/ai";
import { safeSend } from "../services/sender";
import { logger, sanitizeLogInput } from "../utils/logger";
import { DBService } from "../services/database";

const connectionOptions = getRedisOptions();

if (!connectionOptions) {
  logger.warn("ai_worker: no Redis connection options, worker not started");
} else {
  const aiWorker = new Worker(
    "ai-queue",
    async (job: Job) => {
      const { userId, article, lang } = job.data;

      try {
        logger.info(`Job ${job.id}: AI processing for ${sanitizeLogInput(article.title)}`);

        const adKeywords = CONFIG.AD_KEYWORDS.map((k) => k.toLowerCase());
        const textToScan = `${article.title} ${article.content || ""}`.toLowerCase();
        if (adKeywords.some((k) => textToScan.includes(k))) {
          logger.info(`Ad filtered: ${sanitizeLogInput(article.title)}`);
          return;
        }

        const user = await DBService.getUser(userId);
        if (!user || !user.target_channel || !user.is_active) {
          logger.info(`Skip AI: User ${userId} inactive or no channel`);
          return;
        }

        const lockUrl = article.url || '';
        const lockTitle = article.title || '';
        if (!DBService.acquireRecentNewsLock(userId, lockUrl, lockTitle)) {
          await DBService.incrementStat(userId, "total_duplicates");
          return;
        }

        const moderation = await moderateContent(article.title, article.content || "");
        if (moderation.status === "BLOCKED") {
          logger.warn(`Article blocked for user ${userId}: ${sanitizeLogInput(moderation.reason)}`);
          return;
        }

        const isSemanticDup = await checkSemanticDuplicate(userId, article.title, article.content || "");
        if (isSemanticDup) {
          await DBService.incrementStat(userId, "total_duplicates");
          return;
        }

        const intervalMinutes = Math.max(Number(user.interval_minutes) || 15, 1);
        if (!DBService.tryReserveUserSendSlot(userId, intervalMinutes)) {
          logger.info(`Skip AI send for user ${userId}: interval cooldown active`);
          return;
        }

        const userLang = user?.language || lang || "uz";
        const langMap: Record<string, string> = { uz: "O'zbek", ru: "Russian", en: "English", tr: "Turkish" };
        const fullLangName = langMap[userLang] || userLang;

        const systemPrompt = `Summarize this news in ${fullLangName}. Max 100 words, engaging, no source links. Use professional tone. Response MUST be in ${fullLangName}.`;
        const userPrompt = `Title: ${article.title}\nContent: ${article.content || ""}`;

        const summary = await getSmartAIResponse(systemPrompt, userPrompt);
        if (!summary || summary.length < 10) {
          DBService.releaseUserSendSlot(userId);
          logger.warn(`Skip AI: Summary generation failed or too short for user ${userId}`);
          return;
        }

        const category = await categorizeNews(article.title, summary);
        const emoji = await getNiceEmoji(article.title);

        const enrichedArticle = {
          ...article,
          content: summary,
          emoji: emoji || "🔹",
          category,
        };

        await safeSend(user, enrichedArticle);
        if (article.url && article.title) {
          await DBService.markSeen(userId, article.url, article.title);
        }
        logger.info(`Post sent to channel ${user.target_channel} for user ${userId}`);
      } catch (error: unknown) {
        DBService.releaseUserSendSlot(userId);
        const message = error instanceof Error ? error.message : String(error);
        const isPermanent = message.includes("400") || message.includes("Bad Request");
        if (isPermanent) {
          logger.error(`Permanent AI error for job ${job.id}: ${message}. Skipping.`);
          return;
        }

        logger.error(`AI Worker Error for job ${job.id}: ${message}`);
        throw error;
      }
    },
    { connection: connectionOptions }
  );

  aiWorker.on("error", (err) => {
    if (err.message.includes("limit exceeded") || err.message.toLowerCase().includes("exceeded")) {
      logger.warn(`AI worker: limit exceeded (pool rotating automatically)`);
    } else {
      logger.error(`AI worker error: ${err.message}`);
    }
  });

  logger.info("AI Worker started with Redis pool");
}

export {};
