"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceService = void 0;
const database_1 = require("./database");
const logger_1 = require("../utils/logger");
const clustering_1 = require("./clustering");
exports.WorkspaceService = {
    async createWorkspace(userId, name) {
        const existing = await database_1.DBService.getUserWorkspaces(userId);
        if (existing.length >= 3 && !(await database_1.DBService.isPremiumActive(userId))) {
            return { error: 'Free da maksimal 3 ta workspace. Premium ga o\'ting.' };
        }
        const ws = await database_1.DBService.createWorkspace(userId, name);
        return { success: true, workspace: ws };
    },
    async addChannelToWorkspace(workspaceId, channelId, name) {
        const existing = await database_1.DBService.getWorkspaceChannels(workspaceId);
        if (existing.length >= 10)
            return { error: 'Workspace ga maksimal 10 kanal qo\'shish mumkin.' };
        const bot = (await Promise.resolve().then(() => __importStar(require('./bot_instance')))).bot;
        try {
            const chat = await bot.getChat(channelId);
            const me = await bot.getMe();
            const member = await bot.getChatMember(chat.id, me.id);
            if (member.status !== 'administrator' && member.status !== 'creator') {
                return { error: 'Bot kanalda admin emas' };
            }
        }
        catch {
            return { error: 'Kanal tekshirishda xatolik' };
        }
        await database_1.DBService.addWorkspaceChannel(workspaceId, channelId, name);
        return { success: true };
    },
    async rebalanceContent(workspaceId) {
        const channels = await database_1.DBService.getWorkspaceChannels(workspaceId);
        if (channels.length < 2)
            return;
        const clusters = await clustering_1.ClusteringService.getClusters(true);
        if (!clusters.clusters.length)
            return;
        const bot = (await Promise.resolve().then(() => __importStar(require('./bot_instance')))).bot;
        for (const channel of channels) {
            const recent = await database_1.DBService.getRecentTitlesForChannel(channel.channel_id);
            if (recent.length >= 5)
                continue;
            const topic = clusters.clusters[Math.floor(Math.random() * clusters.clusters.length)];
            if (!topic)
                continue;
            try {
                const msg = `📊 <b>${topic.topic}</b>\n\n${topic.summary}\n\n━━━━━━━━━━━━\n📡 NewsBot · Avtomatik rebalans`;
                await bot.sendMessage(channel.channel_id, msg, { parse_mode: 'HTML' });
                logger_1.logger.info(`Rebalanced "${topic.topic}" → ${channel.channel_id}`);
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (e) {
                logger_1.logger.warn(`Rebalance failed for ${channel.channel_id}: ${e.message}`);
            }
        }
    },
};
