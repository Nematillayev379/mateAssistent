"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.WorkspaceRepository = {
    async getByUser(userId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('workspaces').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) {
            logger_1.logger.error(`getUserWorkspaces error: ${error.message}`);
            return [];
        }
        return data || [];
    },
    async create(userId, name) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('workspaces').insert({ user_id: userId, name }).select().single();
        if (error) {
            logger_1.logger.error(`createWorkspace error: ${error.message}`);
            return null;
        }
        return data;
    },
    async getChannels(workspaceId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('workspace_channels').select('*').eq('workspace_id', workspaceId);
        if (error) {
            logger_1.logger.error(`getWorkspaceChannels error: ${error.message}`);
            return [];
        }
        return data || [];
    },
    async addChannel(workspaceId, channelId, name) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('workspace_channels').insert({ workspace_id: workspaceId, channel_id: channelId, name });
        if (error) {
            logger_1.logger.error(`addWorkspaceChannel error: ${error.message}`);
            return false;
        }
        return true;
    },
    async removeChannel(channelId, workspaceId) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('workspace_channels').delete().eq('channel_id', channelId).eq('workspace_id', workspaceId);
        if (error) {
            logger_1.logger.error(`removeWorkspaceChannel error: ${error.message}`);
            return false;
        }
        return true;
    },
    // ── Team Members ──
    async getMembers(workspaceId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('workspace_members').select('*').eq('workspace_id', workspaceId);
        if (error) {
            logger_1.logger.error(`getWorkspaceMembers error: ${error.message}`);
            return [];
        }
        return data || [];
    },
    async addMember(workspaceId, userId, role = 'editor') {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('workspace_members').insert({ workspace_id: workspaceId, user_id: userId, role });
        if (error) {
            logger_1.logger.error(`addWorkspaceMember error: ${error.message}`);
            return false;
        }
        return true;
    },
    async removeMember(workspaceId, userId) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
        if (error) {
            logger_1.logger.error(`removeWorkspaceMember error: ${error.message}`);
            return false;
        }
        return true;
    },
    async updateMemberRole(workspaceId, userId, role) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('workspace_members').update({ role }).eq('workspace_id', workspaceId).eq('user_id', userId);
        if (error) {
            logger_1.logger.error(`updateWorkspaceMemberRole error: ${error.message}`);
            return false;
        }
        return true;
    },
};
