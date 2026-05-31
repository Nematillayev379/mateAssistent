import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { i18n } from "../services/i18n";

export const workspaceCommand: BotCommand = {
  pattern: /^\/workspace(?:\s+(.*))?$/i,
  description: '📋 Workspace boshqaruvi / Workspace management',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    if (!user) return;
    const lang = user.language || 'uz';
    const raw = (match?.[1] || '').trim();

    const workspaces = await DBService.getUserWorkspaces(chatId);

    if (!raw) {
      const list = workspaces.length > 0
        ? workspaces.map((ws: any, i: number) =>
            `${i + 1}. <b>${ws.name}</b> — ${ws.channel_count || 0} kanal\n` +
            `<code>/workspace switch ${ws.id}</code>`
          ).join('\n')
        : 'Hozircha workspace lar yo\'q. Dashboardda yarating.';
      const text = `📋 <b>Workspace boshqaruvi</b>\n\n` +
                   `Workspace — bir nechta kanalga bir vaqtda post yuborish.\n\n` +
                   `<b>Workspacelar:</b>\n${list}\n\n` +
                   (workspaces.length > 0
                     ? `<b>Kanallar:</b>\n<code>/workspace channels WS_ID</code>\n`
                     : '') +
                   `<b>Dashboard:</b>\nWeb dashboard orqali workspace yaratish va kanal qo'shish.`;
      return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }

    const parts = raw.split(/\s+/);
    const sub = parts[0].toLowerCase();

    if (sub === 'switch' && parts[1]) {
      const wsId = parseInt(parts[1], 10);
      const targetWs = workspaces.find((w: any) => w.id === wsId);
      if (!targetWs) {
        return bot.sendMessage(chatId, 'Workspace topilmadi.', { parse_mode: 'HTML' });
      }
      // Store active workspace in settings (no extra DB column needed)
      await DBService.setSetting(`active_ws_${chatId}`, String(wsId));
      return bot.sendMessage(chatId, `✅ Aktiv workspace: <b>${targetWs.name}</b>\n\nEndi barcha kanallarga post yuboriladi.`, { parse_mode: 'HTML' });
    }

    if (sub === 'off' || sub === 'none') {
      await DBService.setSetting(`active_ws_${chatId}`, '');
      return bot.sendMessage(chatId, 'Workspace o\'chirildi. Faqat asosiy kanalga post yuboriladi.');
    }

    if (sub === 'channels' && parts[1]) {
      const wsId = parseInt(parts[1], 10);
      const ws = workspaces.find((w: any) => w.id === wsId);
      if (!ws) return bot.sendMessage(chatId, 'Workspace topilmadi.', { parse_mode: 'HTML' });
      const channels = await DBService.getWorkspaceChannels(wsId);
      const list = channels.length > 0
        ? channels.map((ch: any) => `— ${ch.name} (${ch.channel_id})`).join('\n')
        : 'Kanallar yo\'q. Dashboardda qo\'shing.';
      return bot.sendMessage(chatId, `📋 <b>${ws.name}</b> kanallari:\n\n${list}`, { parse_mode: 'HTML' });
    }

    return bot.sendMessage(chatId, 'Buyruq: /workspace — ro\'yxat, /workspace switch ID — tanlash, /workspace off — o\'chirish', { parse_mode: 'HTML' });
  }
};
