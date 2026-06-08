import { TgMessage, TgUser } from '../types/telegram';
import { bot } from './bot_instance';
import { CONFIG } from '../config/config';
import { DBService } from './database';
import { logger } from '../utils/logger';
import { safeSend, safeSendToChannels } from './sender';
import { getSmartAIResponse } from './ai';
import { Article } from '../types';

/** Normalize @channel, -100id, or numeric id */
export function normalizeTelegramChannelId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('@')) return raw.toLowerCase();
  if (raw.startsWith('-100')) return raw;
  if (/^-?\d+$/.test(raw)) {
    const n = raw.replace('-', '');
    return n.length > 10 ? `-100${n}` : raw;
  }
  return `@${raw.replace('@', '').toLowerCase()}`;
}

export const TelegramMonitorService = {
  async getSubscriptionsForChat(chatId: number | string, chatUsername?: string) {
    const channels = await DBService.getMonitoredChannels();
    const chatKey = String(chatId);
    const usernameKey = chatUsername ? `@${chatUsername.toLowerCase()}` : null;

    return channels.filter((c) => {
      if (c.platform !== 'telegram' || c.is_active === 0 || c.is_active === false) return false;
      const stored = normalizeTelegramChannelId(c.channel_id);
      if (stored === chatKey) return true;
      if (usernameKey && stored === usernameKey) return true;
      if (stored.startsWith('-100') && chatKey === stored) return true;
      return false;
    });
  },

  async isMessageSeen(userId: number, sourceChatId: string, messageId: number): Promise<boolean> {
    return DBService.isTelegramMessageSeen(userId, sourceChatId, messageId);
  },

  async markMessageSeen(userId: number, sourceChatId: string, messageId: number) {
    await DBService.markTelegramMessageSeen(userId, sourceChatId, messageId);
  },

  extractText(msg: TgMessage): string {
    return msg.text || msg.caption || '';
  },

  async handleChannelPost(msg: TgMessage) {
    if (!msg.chat?.id || !msg.message_id) return;

    const chatId = msg.chat.id;
    const username = msg.chat.username;
    const subs = await this.getSubscriptionsForChat(chatId, username);

    if (!subs.length) return;

    logger.info(`📡 TG monitor: ${subs.length} subscriber(s) for chat ${chatId}`);

    for (const sub of subs) {
      try {
        const user = await DBService.getUser(sub.user_id);
        if (!user || !user.is_active || !user.target_channel) continue;

        const sourceKey = String(chatId);
        if (await this.isMessageSeen(sub.user_id, sourceKey, msg.message_id)) {
          await DBService.incrementStat(sub.user_id, 'total_duplicates');
          continue;
        }

        const targets = DBService.getUserOutputChannels(user);
        const forwardMode = sub.forward_mode || 'copy';
        const useAi = sub.use_ai === 1;
        let sent = 0;

        if (forwardMode === 'copy' && !useAi) {
          sent = await safeSendToChannels(user, targets, async (target) => {
            await bot.copyMessage(target, sourceKey, msg.message_id);
          });
        } else if (useAi) {
          const text = this.extractText(msg);
          const title = text.split('\n')[0]?.slice(0, 120) || `TG: ${sub.name || sourceKey}`;
          const rewritten = await getSmartAIResponse(
            "Rewrite this Telegram post as a professional news post in Uzbek with emojis. Keep facts accurate.",
            text.slice(0, 2000) || title
          );
          const article: Article = {
            title,
            content: rewritten,
            url: username ? `https://t.me/${username}/${msg.message_id}` : `https://t.me/c/${String(chatId).replace('-100', '')}/${msg.message_id}`,
            source: sub.name || 'Telegram',
            emoji: '📢',
          };
          if (msg.photo?.length) {
            const photo = msg.photo[msg.photo.length - 1];
            article.imageUrl = photo.file_id;
          }
          sent = await safeSendToChannels(user, targets, async (target) => {
            const u = { ...user, target_channel: target, extra_channels: '' };
            await safeSend(u, article);
          });
        } else {
          sent = await safeSendToChannels(user, targets, async (target) => {
            await bot.forwardMessage(target, sourceKey, msg.message_id);
          });
        }

        if (sent === 0) throw new Error('All Telegram monitor sends failed');

        await this.markMessageSeen(sub.user_id, sourceKey, msg.message_id);
        await DBService.incrementStat(sub.user_id, 'total_posts');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`TG forward failed user ${sub.user_id}: ${msg}`);
      }
    }
  },

  async verifyBotInSourceChannel(channelInput: string): Promise<{ ok: boolean; chatId?: string; title?: string; error?: string }> {
    try {
      const normalized = normalizeTelegramChannelId(channelInput);
      const chat = await bot.getChat(normalized);
      const me = await bot.getMe();
      const member = await bot.getChatMember(chat.id, me.id);
      if (member.status !== 'administrator' && member.status !== 'creator') {
        return { ok: false, error: 'Bot manba kanalda admin emas' };
      }
      return { ok: true, chatId: String(chat.id), title: chat.title || normalized };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },
};
