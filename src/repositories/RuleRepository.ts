import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export const RuleRepository = {
  async getByUser(userId: number): Promise<any[]> {
    const { data, error } = await getSupabase().from('automation_rules').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { logger.error(`getUserRules error: ${error.message}`); return []; }
    return data || [];
  },

  async add(userId: number, trigger: string, condition: string, action: string, actionValue: string): Promise<boolean> {
    const { error } = await getSupabase().from('automation_rules').insert({ user_id: userId, trigger, condition, action, action_value: actionValue });
    if (error) { logger.error(`addRule error: ${error.message}`); return false; }
    return true;
  },

  async toggle(ruleId: number, isActive: boolean): Promise<boolean> {
    const { error } = await getSupabase().from('automation_rules').update({ is_active: isActive }).eq('id', ruleId);
    if (error) { logger.error(`toggleRule error: ${error.message}`); return false; }
    return true;
  },

  async delete(ruleId: number): Promise<boolean> {
    const { error } = await getSupabase().from('automation_rules').delete().eq('id', ruleId);
    if (error) { logger.error(`deleteRule error: ${error.message}`); return false; }
    return true;
  },
};

export const TicketRepository = {
  async create(userId: number, subject: string, message: string) {
    const { data, error } = await getSupabase().from('support_tickets').insert({ user_id: userId, subject, message }).select().single();
    if (error) logger.error(`createTicket error: ${error.message}`);
    return data;
  },

  async getByUser(userId: number) {
    const { data, error } = await getSupabase().from('support_tickets').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) logger.error(`getUserTickets error: ${error.message}`);
    return data || [];
  },

  async getAll() {
    const { data, error } = await getSupabase().from('support_tickets').select('*, users(username, first_name)').order('created_at', { ascending: false });
    if (error) logger.error(`getTickets error: ${error.message}`);
    return data || [];
  },

  async updateStatus(ticketId: number, status: string) {
    if (!['open', 'closed', 'resolved'].includes(status)) return;
    await getSupabase().from('support_tickets').update({ status }).eq('id', ticketId);
  },
};

export const DraftRepository = {
  async save(userId: number, draft: { title?: string; body: string; image_url?: string; channels?: string[] }) {
    const { data, error } = await getSupabase().from('post_drafts').insert({
      user_id: userId, title: draft.title || null, body: draft.body,
      image_url: draft.image_url || null, channels: draft.channels || null, status: 'draft',
    }).select().single();
    if (error) logger.error(`savePostDraft error: ${error.message}`);
    return data;
  },

  async getByUser(userId: number) {
    const { data } = await getSupabase().from('post_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
    return data || [];
  },
};
