import { DBService } from './database';
import { logger } from '../utils/logger';
import { ClusteringService } from './clustering';

export const WorkspaceService = {
  async createWorkspace(userId: number, name: string) {
    const existing = await DBService.getUserWorkspaces(userId);
    if (existing.length >= 3 && !(await DBService.isPremiumActive(userId))) {
      return { error: 'Free da maksimal 3 ta workspace. Premium ga o\'ting.' };
    }
    const ws = await DBService.createWorkspace(userId, name);
    return { success: true, workspace: ws };
  },

  async addChannelToWorkspace(workspaceId: number, channelId: string, name: string) {
    const existing = await DBService.getWorkspaceChannels(workspaceId);
    if (existing.length >= 10) return { error: 'Workspace ga maksimal 10 kanal qo\'shish mumkin.' };

    const bot = (await import('./bot_instance')).bot;
    try {
      const chat = await bot.getChat(channelId);
      const me = await bot.getMe();
      const member = await bot.getChatMember(chat.id, me.id);
      if (member.status !== 'administrator' && member.status !== 'creator') {
        return { error: 'Bot kanalda admin emas' };
      }
    } catch { return { error: 'Kanal tekshirishda xatolik' }; }

    await DBService.addWorkspaceChannel(workspaceId, channelId, name);
    return { success: true };
  },

  async rebalanceContent(workspaceId: number) {
    const channels = await DBService.getWorkspaceChannels(workspaceId);
    if (channels.length < 2) return;

    const clusters = await ClusteringService.getClusters(true);
    if (!clusters.clusters.length) return;

    const bot = (await import('./bot_instance')).bot;
    for (const channel of channels) {
      const recent = await DBService.getRecentTitlesForChannel(channel.channel_id);
      if (recent.length >= 5) continue;

      const topic = clusters.clusters[Math.floor(Math.random() * clusters.clusters.length)];
      if (!topic) continue;

      try {
        const msg = `📊 <b>${topic.topic}</b>\n\n${topic.summary}\n\n━━━━━━━━━━━━\n📡 NewsBot · Avtomatik rebalans`;
        await bot.sendMessage(channel.channel_id, msg, { parse_mode: 'HTML' });
        logger.info(`Rebalanced "${topic.topic}" → ${channel.channel_id}`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Rebalance failed for ${channel.channel_id}: ${msg}`);
      }
    }
  },
};
