import { bot } from "./bot_instance";
import { DBService } from "./database";
import { ScraperService } from "./scraper";
import { logger } from "../utils/logger";

const sendFailureAlertCooldowns = new Map<string, number>();
let cachedBotUser: string | null = null;
let lastBotUserFetch = 0;

function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeUrl(text: string): string {
  return String(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "%3C").replace(/>/g, "%3E");
}

function normalizeChannelId(channel: string): string {
  let targetChannel = String(channel).trim();
  if (!targetChannel) return "";
  if (/^\d+$/.test(targetChannel)) targetChannel = `-100${targetChannel}`;
  else if (!targetChannel.startsWith("@") && !targetChannel.startsWith("-")) targetChannel = `@${targetChannel}`;
  return targetChannel;
}

async function getBotUsername(): Promise<string> {
  if (!cachedBotUser || Date.now() - lastBotUserFetch > 3600000) {
    try {
      const me = await bot.getMe();
      cachedBotUser = me.username || "bot";
      lastBotUserFetch = Date.now();
    } catch {
      cachedBotUser = cachedBotUser || "bot";
    }
  }
  return cachedBotUser || "bot";
}

export async function buildChannelPostMarkup(article: {
  title?: string;
  content?: string;
  source?: string;
  url?: string;
}, opts?: { maxLength?: number }): Promise<string> {
  const botUser = await getBotUsername();
  const safeTitle = escapeHtml(article.title || "");
  const safeContent = escapeHtml(article.content || "");
  const safeSource = escapeHtml(article.source || "yangiliklar");
  const safeUrl = escapeUrl(article.url || "");
  const sourceLine = safeUrl
    ? `🌐 <a href="${safeUrl}">${safeSource}</a>`
    : `🌐 ${safeSource}`;
  const botLine = `🤖 <a href="https://t.me/${botUser}">@${botUser}</a>`;
  const footer = `\n\n${sourceLine}\n${botLine}`;
  const titleBlock = `<b>${safeTitle}</b>`;
  const maxLen = opts?.maxLength || 4096;
  const availableForContent = Math.max(0, maxLen - titleBlock.length - footer.length - 6);

  let finalContent = safeContent;
  if (finalContent.length > availableForContent) {
    finalContent = finalContent.slice(0, Math.max(0, availableForContent - 3)) + "...";
  }

  return `${titleBlock}\n\n${finalContent}${footer}`;
}

export async function safeSendToChannels(
  _user: any,
  channels: string[],
  sendFn: (normalizedChannel: string) => Promise<void>
): Promise<number> {
  const results = await Promise.allSettled(
    channels.map(async (ch) => {
      const normalized = normalizeChannelId(ch);
      if (!normalized) throw new Error("Empty target channel");
      await sendFn(normalized);
    })
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn(`Multi-channel send failed ${channels[index]}: ${result.reason?.message || result.reason}`);
    }
  });
  return results.filter((result) => result.status === "fulfilled").length;
}

export async function safeSend(user: any, article: any): Promise<void> {
  if (!article) {
    logger.warn("safeSend skipped: article is missing");
    return;
  }

  const isMediaMessage = !!(article.videoUrl || article.audioUrl || article.imageUrl);
  const caption = await buildChannelPostMarkup(article, { maxLength: isMediaMessage ? 1024 : 4096 });

  try {
    if (!user.target_channel) {
      logger.warn(`Skip send: User ${user.telegram_id} has no target channel`);
      return;
    }

    const targets = DBService.getUserOutputChannels(user);
    const sent = await safeSendToChannels(user, targets.length ? targets : [user.target_channel], async (targetChannel) => {
      if (article.videoUrl && ScraperService.isMediaUrl(article.videoUrl)) {
        await bot.sendVideo(targetChannel, article.videoUrl, { caption, parse_mode: "HTML" });
      } else if (article.audioUrl && ScraperService.isMediaUrl(article.audioUrl)) {
        await bot.sendAudio(targetChannel, article.audioUrl, { caption, parse_mode: "HTML" });
      } else if (article.imageUrl) {
        await bot.sendPhoto(targetChannel, article.imageUrl, { caption, parse_mode: "HTML" });
      } else {
        await bot.sendMessage(targetChannel, caption, { parse_mode: "HTML" });
      }
    });

    if (sent === 0) throw new Error("All target channel sends failed");
    await DBService.incrementStat(user.telegram_id, "total_posts");
  } catch (e: any) {
    logger.error(`safeSend error: ${e.message}`);
    try {
      const cooldownKey = `${user.telegram_id}:${normalizeChannelId(user.target_channel || "")}`;
      const now = Date.now();
      if (now >= (sendFailureAlertCooldowns.get(cooldownKey) || 0)) {
        sendFailureAlertCooldowns.set(cooldownKey, now + 30 * 60 * 1000);
        await bot.sendMessage(
          user.telegram_id,
          `⚠️ <b>Xatolik!</b>\n\nKanalingizga xabar yuborib bo'lmadi. Iltimos, botni kanalga admin qilganingizni va kanal manzili to'g'riligini tekshiring.\n\nXato: <code>${escapeHtml(e.message)}</code>`,
          { parse_mode: "HTML" }
        );
      }
    } catch (inner: any) {
      logger.warn(`Error alert cooldown send failed: ${inner.message}`);
    }
    throw e;
  }
}
