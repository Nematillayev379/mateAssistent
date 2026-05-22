import { getSupabase } from "./BaseRepository";

export const UserRepository = {
  async get(telegramId: number) {
    const { data, error } = await getSupabase().from('users').select('*').eq('telegram_id', telegramId).single();
    if (error && error.code !== 'PGRST116') console.error(`getUser error: ${error.message}`);
    return data;
  },

  async getAll() {
    const { data, error } = await getSupabase().from('users').select('*');
    if (error) console.error(`getAllUsers error: ${error.message}`);
    return data || [];
  },

  async getActive() {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .or('is_active.eq.1,is_active.is.null')
      .not('target_channel', 'is', null)
      .eq('is_approved', 1);
    if (error) console.error(`getActiveUsers error: ${error.message}`);
    return (data || []).filter((u: any) => typeof u.target_channel === 'string' && u.target_channel.trim() !== '');
  },

  async upsert(telegramId: number, isOwner = 0, username?: string, firstName?: string) {
    const insertData: Record<string, any> = {
      telegram_id: telegramId, is_owner: isOwner, is_active: 1, is_approved: 1,
      role: isOwner === 1 ? 'owner' : 'user', interval_minutes: 15, language: 'uz',
      username: username || null, first_name: firstName || null,
    };
    let { data, error } = await getSupabase().from('users').upsert(insertData, { onConflict: 'telegram_id' }).select().single();
    if (error) {
      console.error(`upsertUser error: ${error.message}`);
      const fallback = { ...insertData };
      delete fallback.role;
      const fb = await getSupabase().from('users').upsert(fallback, { onConflict: 'telegram_id' }).select().single();
      if (fb.error) { console.error(`upsertUser fallback failed: ${fb.error.message}`); return null; }
      data = fb.data;
      if (isOwner === 1 && data) await getSupabase().from('users').update({ is_owner: 1 }).eq('telegram_id', telegramId);
    }
    return data;
  },

  async update(telegramId: number, updates: Record<string, any>): Promise<boolean> {
    const safe = { ...updates };
    if (typeof safe.target_channel === 'string') {
      let ch = String(safe.target_channel || '').trim();
      if (ch.includes('t.me/')) { const parts = ch.split('t.me/'); const h = parts[parts.length - 1].split('/')[0].trim(); if (h) ch = `@${h}`; }
      if (!ch.startsWith('@') && !ch.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(ch)) ch = `@${ch}`;
      safe.target_channel = ch;
    }
    const { error } = await getSupabase().from('users').update(safe).eq('telegram_id', telegramId);
    if (error) { console.error(`updateUser error: ${error.message}`); return false; }
    return true;
  },

  async getByReferralCode(code: string) {
    const { data } = await getSupabase().from('users').select('*').eq('referral_code', code.toUpperCase()).maybeSingle();
    return data;
  },

  async getForAdmin() {
    const { data, error } = await getSupabase().from('users').select('*').order('created_at', { ascending: false });
    if (error) { console.error(`getUsersForAdmin error: ${error.message}`); return []; }
    return (data || []);
  },

  outputChannels(user: any): string[] {
    const list: string[] = [];
    if (user?.target_channel) list.push(String(user.target_channel).trim());
    if (user?.extra_channels) {
      user.extra_channels.split(',').forEach((c: string) => { const t = c.trim(); if (t) list.push(t); });
    }
    return [...new Set(list)];
  },
};
