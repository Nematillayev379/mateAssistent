import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export type MonitoredChannelRecord = {
  id: number;
  user_id: number;
  platform: string;
  channel_id: string;
  name: string;
  forward_mode: string;
  use_ai: number;
  is_active: number;
  last_post_id?: string;
  last_check?: string;
};

export const MonitorRepository = {
  async getByUser(userId: number): Promise<MonitoredChannelRecord[]> {
    const { data, error } = await getSupabase().from('monitored_channels').select('*').eq('user_id', userId);
    if (error) logger.error(`getUserMonitoredChannels error: ${error.message}`);
    return (data || []) as MonitoredChannelRecord[];
  },

  async add(userId: number, platform: string, channelId: string, name: string, opts?: { forward_mode?: string; use_ai?: number }) {
    const row: Record<string, unknown> = { user_id: userId, platform, channel_id: channelId, name, forward_mode: opts?.forward_mode || 'copy', use_ai: opts?.use_ai ?? 0, is_active: 1 };
    const { error } = await getSupabase().from('monitored_channels').insert(row);
    if (error) logger.error(`addMonitoredChannel error: ${error.message}`);
  },

  async updateSettings(id: number, userId: number, updates: Record<string, unknown>) {
    const { error } = await getSupabase().from('monitored_channels').update(updates).eq('id', id).eq('user_id', userId);
    if (error) logger.error(`updateMonitoredChannelSettings error: ${error.message}`);
  },

  async remove(userId: number, id: number) {
    const { error } = await getSupabase().from('monitored_channels').delete().eq('id', id).eq('user_id', userId);
    if (error) logger.error(`removeMonitoredChannel error: ${error.message}`);
  },

  async getAll() {
    const { data, error } = await getSupabase().from('monitored_channels').select('*');
    if (error) logger.error(`getMonitoredChannels error: ${error.message}`);
    return data || [];
  },

  async updateLastPost(id: number, lastPostId: string) {
    const { error } = await getSupabase().from('monitored_channels').update({ last_post_id: lastPostId, last_check: new Date().toISOString() }).eq('id', id);
    if (error) logger.error(`updateMonitoredChannel error: ${error.message}`);
  },
};

export const TelegramMessageRepository = {
  async isSeen(userId: number, sourceChatId: string, messageId: number): Promise<boolean> {
    const { data } = await getSupabase().from('telegram_seen_messages').select('id').eq('user_id', userId).eq('source_chat_id', sourceChatId).eq('message_id', messageId).maybeSingle();
    return !!data;
  },

  async markSeen(userId: number, sourceChatId: string, messageId: number) {
    const { error } = await getSupabase().from('telegram_seen_messages').insert({ user_id: userId, source_chat_id: sourceChatId, message_id: messageId });
    if (error && !String(error.message).includes('duplicate') && error.code !== '23505') logger.warn(`markTelegramMessageSeen: ${error.message}`);
  },
};

export const TrendsRepository = {
  async saveSnapshot(topics: Array<{ topic: string; score: number }>, summary: string) {
    const { error } = await getSupabase().from('trends_snapshots').insert({ topics, summary });
    if (error) logger.error(`saveTrendsSnapshot error: ${error.message}`);
  },

  async getLatest() {
    const { data, error } = await getSupabase().from('trends_snapshots').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) logger.error(`getLatestTrendsSnapshot error: ${error.message}`);
    return data;
  },
};
