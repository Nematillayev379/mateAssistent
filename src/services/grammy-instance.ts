import { Bot } from 'grammy';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

let _bot: Bot | null = null;

export function getGrammyBot(): Bot {
  if (!_bot) {
    _bot = new Bot(CONFIG.TELEGRAM_TOKEN);
  }
  return _bot;
}

export async function initGrammyBot(): Promise<void> {
  const bot = getGrammyBot();
  try {
    await bot.init();
    logger.info(`Grammy bot initialized: @${bot.botInfo.username} (id: ${bot.botInfo.id})`);
  } catch (e: unknown) {
    logger.error(`Grammy bot init FAILED: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}
