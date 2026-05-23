import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export const WorkspaceRepository = {
  async getByUser(userId: number): Promise<any[]> {
    const { data, error } = await getSupabase().from('workspaces').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { logger.error(`getUserWorkspaces error: ${error.message}`); return []; }
    return data || [];
  },

  async create(userId: number, name: string): Promise<any> {
    const { data, error } = await getSupabase().from('workspaces').insert({ user_id: userId, name }).select().single();
    if (error) { logger.error(`createWorkspace error: ${error.message}`); return null; }
    return data;
  },

  async getChannels(workspaceId: number): Promise<any[]> {
    const { data, error } = await getSupabase().from('workspace_channels').select('*').eq('workspace_id', workspaceId);
    if (error) { logger.error(`getWorkspaceChannels error: ${error.message}`); return []; }
    return data || [];
  },

  async addChannel(workspaceId: number, channelId: string, name: string): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_channels').insert({ workspace_id: workspaceId, channel_id: channelId, name });
    if (error) { logger.error(`addWorkspaceChannel error: ${error.message}`); return false; }
    return true;
  },

  async removeChannel(channelId: string, workspaceId: number): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_channels').delete().eq('channel_id', channelId).eq('workspace_id', workspaceId);
    if (error) { logger.error(`removeWorkspaceChannel error: ${error.message}`); return false; }
    return true;
  },
};
