import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export type WorkspaceRecord = {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
};

export type WorkspaceChannelRecord = {
  id: number;
  workspace_id: number;
  channel_id: string;
  name: string;
};

export type WorkspaceMemberRecord = {
  id: number;
  workspace_id: number;
  user_id: number;
  role: string;
};

export const WorkspaceRepository = {
  async getByUser(userId: number): Promise<WorkspaceRecord[]> {
    const { data, error } = await getSupabase().from('workspaces').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { logger.error(`getUserWorkspaces error: ${error.message}`); return []; }
    return (data || []) as WorkspaceRecord[];
  },

  async create(userId: number, name: string): Promise<WorkspaceRecord | null> {
    const { data, error } = await getSupabase().from('workspaces').insert({ user_id: userId, name }).select().single();
    if (error) { logger.error(`createWorkspace error: ${error.message}`); return null; }
    return data as WorkspaceRecord;
  },

  async getChannels(workspaceId: number): Promise<WorkspaceChannelRecord[]> {
    const { data, error } = await getSupabase().from('workspace_channels').select('*').eq('workspace_id', workspaceId);
    if (error) { logger.error(`getWorkspaceChannels error: ${error.message}`); return []; }
    return (data || []) as WorkspaceChannelRecord[];
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

  async getMembers(workspaceId: number): Promise<WorkspaceMemberRecord[]> {
    const { data, error } = await getSupabase().from('workspace_members').select('*').eq('workspace_id', workspaceId);
    if (error) { logger.error(`getWorkspaceMembers error: ${error.message}`); return []; }
    return (data || []) as WorkspaceMemberRecord[];
  },

  async addMember(workspaceId: number, userId: number, role: string = 'editor'): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_members').insert({ workspace_id: workspaceId, user_id: userId, role });
    if (error) { logger.error(`addWorkspaceMember error: ${error.message}`); return false; }
    return true;
  },

  async removeMember(workspaceId: number, userId: number): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
    if (error) { logger.error(`removeWorkspaceMember error: ${error.message}`); return false; }
    return true;
  },

  async updateMemberRole(workspaceId: number, userId: number, role: string): Promise<boolean> {
    const { error } = await getSupabase().from('workspace_members').update({ role }).eq('workspace_id', workspaceId).eq('user_id', userId);
    if (error) { logger.error(`updateWorkspaceMemberRole error: ${error.message}`); return false; }
    return true;
  },
};
