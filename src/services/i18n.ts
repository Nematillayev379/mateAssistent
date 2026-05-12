import i18next from 'i18next';
import { logger } from '../utils/logger';

export const i18n = i18next;

export async function initI18n() {
  await i18n.init({
    lng: 'uz',
    fallbackLng: 'uz',
    resources: {
      uz: {
        translation: {
          welcome: '🌐 <b>Newsroom Web3 Ekotizimiga xush kelibsiz!</b>',
          help: '📚 <b>Yordam bo\'limi:</b>',
          settings: '⚙️ <b>Sozlamalar:</b>',
          premium_activated: '🚀 <b>Premium faollashtirildi!</b>',
          // Add more translations here
        }
      },
      ru: {
        translation: {
          welcome: '🌐 <b>Добро пожаловать в экосистему Newsroom Web3!</b>',
          help: '📚 <b>Раздел помощи:</b>',
          settings: '⚙️ <b>Настройки:</b>',
          premium_activated: '🚀 <b>Премиум активирован!</b>',
        }
      },
      en: {
        translation: {
          welcome: '🌐 <b>Welcome to Newsroom Web3 Ecosystem!</b>',
          help: '📚 <b>Help Section:</b>',
          settings: '⚙️ <b>Settings:</b>',
          premium_activated: '🚀 <b>Premium Activated!</b>',
        }
      }
    }
  });
  logger.info('🌐 i18n initialized');
}
