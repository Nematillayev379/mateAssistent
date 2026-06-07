import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";
import type { ScheduledPost } from "../types";

export const PriceRepository = {
  async add(userId: number, url: string, name: string, price: number) {
    const { error } = await getSupabase().from('tracked_prices').insert({ user_id: userId, url, item_name: name, last_price: price });
    if (error) { logger.error(`addTrackedPrice error: ${error.message}`); throw new Error('Narxni kuzatuvga olishda xatolik.'); }
  },

  async getByUser(userId: number) {
    const { data } = await getSupabase().from('tracked_prices').select('*').eq('user_id', userId);
    return data || [];
  },

  async getAll() {
    const { data } = await getSupabase().from('tracked_prices').select('*');
    return data || [];
  },

  async updatePrice(id: number, newPrice: number) {
    const { error } = await getSupabase().from('tracked_prices').update({ last_price: newPrice }).eq('id', id);
    if (error) logger.error(`updatePrice error: ${error.message}`);
  },

  async remove(userId: number, id: number) {
    const { error } = await getSupabase().from('tracked_prices').delete().eq('id', id).eq('user_id', userId);
    if (error) logger.error(`removePrice error: ${error.message}`);
  },
};

export const SettingsRepository = {
  async get(key: string): Promise<string | null> {
    const { data } = await getSupabase().from('settings').select('value').eq('key', key).maybeSingle();
    return data?.value ?? null;
  },

  async set(key: string, value: string) {
    await getSupabase().from('settings').upsert({ key, value }, { onConflict: 'key' });
  },
};

export const ScheduleRepository = {
  async add(userId: number, type: 'video' | 'audio' | 'text', content: Record<string, unknown>, scheduledAt: string) {
    const validTypes = ['video', 'audio', 'text'];
    if (!validTypes.includes(type)) throw new Error(`Invalid scheduled post type: ${type}`);
    if (!scheduledAt || isNaN(Date.parse(scheduledAt))) throw new Error(`Invalid scheduledAt: ${scheduledAt}`);
    const { error } = await getSupabase().from('scheduled_posts').insert({ user_id: userId, type, content, scheduled_at: scheduledAt, status: 'pending' });
    if (error) logger.error(`addScheduledPost error: ${error.message}`);
  },

  async cancel(userId: number, id: number) {
    const { error } = await getSupabase().from('scheduled_posts').update({ status: 'cancelled' }).eq('id', id).eq('user_id', userId);
    if (error) logger.error(`cancelScheduledPost error: ${error.message}`);
  },

  async getPending() {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase().from('scheduled_posts').select('*').eq('status', 'pending').lte('scheduled_at', now);
    if (error) logger.error(`getPendingScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async getByUser(userId: number) {
    const { data, error } = await getSupabase().from('scheduled_posts').select('*').eq('user_id', userId).in('status', ['pending', 'sent']).order('scheduled_at', { ascending: false });
    if (error) logger.error(`getUserScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async markSent(id: number) {
    await getSupabase().from('scheduled_posts').update({ status: 'sent' }).eq('id', id);
  },

  async updateStatus(id: number, status: string) {
    await getSupabase().from('scheduled_posts').update({ status }).eq('id', id);
  },

  async getById(userId: number, id: number): Promise<ScheduledPost | null> {
    const { data, error } = await getSupabase()
      .from('scheduled_posts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { logger.error(`getScheduledPostById error: ${error.message}`); return null; }
    return (data as ScheduledPost | null) ?? null;
  },

  async getStats(userId: number): Promise<{ pending: number; sent: number; failed: number; cancelled: number }> {
    const { data, error } = await getSupabase()
      .from('scheduled_posts')
      .select('status', { count: 'exact' })
      .eq('user_id', userId);
    const stats = { pending: 0, sent: 0, failed: 0, cancelled: 0 };
    if (error) { logger.error(`getScheduledPostStats error: ${error.message}`); return stats; }
    for (const row of (data || []) as Array<{ status: ScheduledPost['status'] }>) {
      if (row.status in stats) stats[row.status]++;
    }
    return stats;
  },
};
