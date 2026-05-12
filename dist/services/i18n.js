"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.i18n = void 0;
exports.initI18n = initI18n;
const i18next_1 = __importDefault(require("i18next"));
const logger_1 = require("../utils/logger");
exports.i18n = i18next_1.default;
async function initI18n() {
    await exports.i18n.init({
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
    logger_1.logger.info('🌐 i18n initialized');
}
