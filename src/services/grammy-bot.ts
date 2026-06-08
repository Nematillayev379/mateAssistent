import { Bot, Context, webhookCallback } from 'grammy';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

// Grammy bot instance
export const grammyBot = new Bot(CONFIG.TELEGRAM_TOKEN);

// Register command handlers
grammyBot.command('start', async (ctx) => {
  const { startCommand } = await import('../commands/start');
  const msg = {
    chat: { id: ctx.chat.id },
    from: ctx.from,
    text: ctx.message?.text || '',
    message_id: ctx.message?.message_id || 0,
  } as any;
  await startCommand.handler(grammyBot as any, msg, null);
});

grammyBot.command('status', async (ctx) => {
  const { statusCommand } = await import('../commands/status');
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, message_id: ctx.message?.message_id || 0 } as any;
  await statusCommand.handler(grammyBot as any, msg, null);
});

grammyBot.command('help', async (ctx) => {
  const { helpCommand } = await import('../commands/help');
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, message_id: ctx.message?.message_id || 0 } as any;
  await helpCommand.handler(grammyBot as any, msg, null);
});

grammyBot.command('admin', async (ctx) => {
  const { adminCommand } = await import('../commands/admin');
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, text: ctx.message?.text || '', message_id: ctx.message?.message_id || 0 } as any;
  await adminCommand.handler(grammyBot as any, msg, null);
});

grammyBot.command('setchannel', async (ctx) => {
  const { setChannelCommand } = await import('../commands/setchannel');
  const text = ctx.message?.text || '';
  const match = text.match(/^\/setchannel(?:\s+(.*))?$/i);
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, text, message_id: ctx.message?.message_id || 0 } as any;
  await setChannelCommand.handler(grammyBot as any, msg, match as any);
});

grammyBot.command('track', async (ctx) => {
  const { trackCommand } = await import('../commands/track');
  const text = ctx.message?.text || '';
  const match = text.match(/^\/track\s*(.*)|\/kuzatish\s*(.*)|\/manba\s*(.*)$/i);
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, text, message_id: ctx.message?.message_id || 0 } as any;
  await trackCommand.handler(grammyBot as any, msg, match as any);
});

grammyBot.command('workspace', async (ctx) => {
  const { workspaceCommand } = await import('../commands/workspace');
  const text = ctx.message?.text || '';
  const match = text.match(/^\/workspace(?:\s+(.*))?$/i);
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, text, message_id: ctx.message?.message_id || 0 } as any;
  await workspaceCommand.handler(grammyBot as any, msg, match as any);
});

grammyBot.command('lang', async (ctx) => {
  const { langCommand } = await import('../commands/lang');
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, message_id: ctx.message?.message_id || 0 } as any;
  await langCommand.handler(grammyBot as any, msg, null);
});

grammyBot.command('schedule', async (ctx) => {
  const { scheduleCommand } = await import('../commands/schedule');
  const text = ctx.message?.text || '';
  const match = text.match(/^\/schedule(?:@\w+)?(?:\s+(.+))?$/i);
  const msg = { chat: { id: ctx.chat.id }, from: ctx.from, text, message_id: ctx.message?.message_id || 0 } as any;
  await scheduleCommand.handler(grammyBot as any, msg, match as any);
});

// Callback query handler
grammyBot.on('callback_query:data', async (ctx) => {
  const { handleCallbackQuery } = await import('../commands/callbacks');
  const query = {
    id: ctx.callbackQuery.id,
    data: ctx.callbackQuery.data,
    from: ctx.callbackQuery.from,
    message: ctx.callbackQuery.message ? {
      chat: { id: ctx.callbackQuery.message.chat.id },
      message_id: ctx.callbackQuery.message.message_id,
      text: ctx.callbackQuery.message.text,
    } : undefined,
  } as any;
  const userStates = new Map();
  await handleCallbackQuery(grammyBot as any, query, userStates);
});

// Message handler for non-command messages
grammyBot.on('message', async (ctx) => {
  const msg = ctx.message;
  if (!msg) return;

  // Delegate to existing registerCommands message handler
  const { registerCommands } = await import('../commands');
  // The message handler is already registered via registerCommands in telegram.ts
  // We skip duplicate handling here
});

export async function startGrammyBot() {
  // Set bot commands
  await grammyBot.api.setMyCommands([
    { command: 'start', description: 'Boshlash / Main Menu' },
    { command: 'status', description: 'Statistika / Stats' },
    { command: 'setchannel', description: 'Kanalni sozlash / Change channel' },
    { command: 'track', description: 'Narx kuzatish / Price tracking' },
    { command: 'workspace', description: 'Workspace boshqaruvi / Workspace' },
    { command: 'lang', description: "Tilni o'zgartirish / Language" },
    { command: 'help', description: 'Yordam / Help Guide' },
    { command: 'admin', description: 'Admin panel / Admin' },
  ]);

  // Webhook or polling
  if (CONFIG.PUBLIC_URL && process.env.NODE_ENV !== 'development') {
    const webhookUrl = `${CONFIG.PUBLIC_URL}/api/bot/webhook`;
    grammyBot.api.setWebhook(webhookUrl, {
      secret_token: CONFIG.WEBHOOK_SECRET,
      max_connections: 100,
    });
    logger.info(`Grammy webhook set: ${webhookUrl}`);
  } else {
    grammyBot.start({
      onStart: () => { logger.info('Grammy bot started (polling)'); },
    });
  }
}
