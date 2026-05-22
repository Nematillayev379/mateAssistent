import { getSupabase } from "./BaseRepository";

export const PriceRepository = {
  async add(userId: number, url: string, name: string, price: number) {
    const { error } = await getSupabase().from('tracked_prices').insert({ user_id: userId, url, item_name: name, last_price: price });
    if (error) { console.error(`addTrackedPrice error: ${error.message}`); throw new Error('Narxni kuzatuvga olishda xatolik.'); }
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
    await getSupabase().from('tracked_prices').update({ last_price: newPrice }).eq('id', id);
  },

  async remove(userId: number, id: number) {
    await getSupabase().from('tracked_prices').delete().eq('id', id).eq('user_id', userId);
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
  async add(userId: number, type: 'video' | 'audio' | 'text', content: any, scheduledAt: string) {
    const validTypes = ['video', 'audio', 'text'];
    if (!validTypes.includes(type)) throw new Error(`Invalid scheduled post type: ${type}`);
    if (!scheduledAt || isNaN(Date.parse(scheduledAt))) throw new Error(`Invalid scheduledAt: ${scheduledAt}`);
    const { error } = await getSupabase().from('scheduled_posts').insert({ user_id: userId, type, content, scheduled_at: scheduledAt, status: 'pending' });
    if (error) console.error(`addScheduledPost error: ${error.message}`);
  },

  async cancel(userId: number, id: number) {
    const { error } = await getSupabase().from('scheduled_posts').update({ status: 'cancelled' }).eq('id', id).eq('user_id', userId);
    if (error) console.error(`cancelScheduledPost error: ${error.message}`);
  },

  async getPending() {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase().from('scheduled_posts').select('*').in('status', ['pending', 'failed']).lte('scheduled_at', now);
    if (error) console.error(`getPendingScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async getByUser(userId: number) {
    const { data, error } = await getSupabase().from('scheduled_posts').select('*').eq('user_id', userId).in('status', ['pending', 'sent']).order('scheduled_at', { ascending: false });
    if (error) console.error(`getUserScheduledPosts error: ${error.message}`);
    return data || [];
  },

  async markSent(id: number) {
    await getSupabase().from('scheduled_posts').update({ status: 'sent' }).eq('id', id);
  },

  async updateStatus(id: number, status: string) {
    await getSupabase().from('scheduled_posts').update({ status }).eq('id', id);
  },
};
