import { Bot } from 'grammy';
import { CONFIG } from '../config/config';

let _bot: Bot | null = null;

export function getGrammyBot(): Bot {
  if (!_bot) {
    _bot = new Bot(CONFIG.TELEGRAM_TOKEN);
  }
  return _bot;
}
