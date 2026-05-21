"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramMonitorService = void 0;
exports.normalizeTelegramChannelId = normalizeTelegramChannelId;
const bot_instance_1 = require("./bot_instance");
const database_1 = require("./database");
const logger_1 = require("../utils/logger");
const telegram_1 = require("./telegram");
const ai_1 = require("./ai");
/** Normalize @channel, -100id, or numeric id */
function normalizeTelegramChannelId(input) {
    const raw = String(input || '').trim();
    if (!raw)
        return '';
    if (raw.startsWith('@'))
        return raw.toLowerCase();
    if (raw.startsWith('-100'))
        return raw;
    if (/^-?\d+$/.test(raw)) {
        const n = raw.replace('-', '');
        return n.length > 10 ? `-100${n}` : raw;
    }
    return `@${raw.replace('@', '').toLowerCase()}`;
}
exports.TelegramMonitorService = {
    async getSubscriptionsForChat(chatId, chatUsername) {
        const channels = await database_1.DBService.getMonitoredChannels();
        const chatKey = String(chatId);
        const usernameKey = chatUsername ? `@${chatUsername.toLowerCase()}` : null;
        return channels.filter((c) => {
            if (c.platform !== 'telegram' || c.is_active === 0 || c.is_active === false)
                return false;
            const stored = normalizeTelegramChannelId(c.channel_id);
            if (stored === chatKey)
                return true;
            if (usernameKey && stored === usernameKey)
                return true;
            if (stored.startsWith('-100') && chatKey === stored)
                return true;
            return false;
        });
    },
    async isMessageSeen(userId, sourceChatId, messageId) {
        return database_1.DBService.isTelegramMessageSeen(userId, sourceChatId, messageId);
    },
    async markMessageSeen(userId, sourceChatId, messageId) {
        await database_1.DBService.markTelegramMessageSeen(userId, sourceChatId, messageId);
    },
    extractText(msg) {
        return msg.text || msg.caption || '';
    },
    async handleChannelPost(msg) {
        if (!msg.chat?.id || !msg.message_id)
            return;
        const chatId = msg.chat.id;
        const username = msg.chat.username;
        const subs = await this.getSubscriptionsForChat(chatId, username);
        if (!subs.length)
            return;
        logger_1.logger.info(`📡 TG monitor: ${subs.length} subscriber(s) for chat ${chatId}`);
        for (const sub of subs) {
            try {
                const user = await database_1.DBService.getUser(sub.user_id);
                if (!user || !user.is_active || !user.target_channel)
                    continue;
                const sourceKey = String(chatId);
                if (await this.isMessageSeen(sub.user_id, sourceKey, msg.message_id)) {
                    await database_1.DBService.incrementStat(sub.user_id, 'total_duplicates');
                    continue;
                }
                const targets = database_1.DBService.getUserOutputChannels(user);
                const forwardMode = sub.forward_mode || 'copy';
                const useAi = sub.use_ai === 1;
                let sent = 0;
                if (forwardMode === 'copy' && !useAi) {
                    sent = await (0, telegram_1.safeSendToChannels)(user, targets, async (target) => {
                        await bot_instance_1.bot.copyMessage(target, sourceKey, msg.message_id);
                    });
                }
                else if (useAi) {
                    const text = this.extractText(msg);
                    const title = text.split('\n')[0]?.slice(0, 120) || `TG: ${sub.name || sourceKey}`;
                    const rewritten = await (0, ai_1.getSmartAIResponse)("Rewrite this Telegram post as a professional news post in Uzbek with emojis. Keep facts accurate.", text.slice(0, 2000) || title);
                    const article = {
                        title,
                        content: rewritten,
                        url: username ? `https://t.me/${username}/${msg.message_id}` : `https://t.me/c/${String(chatId).replace('-100', '')}/${msg.message_id}`,
                        source: sub.name || 'Telegram',
                        emoji: '📢',
                    };
                    if (msg.photo?.length) {
                        const photo = msg.photo[msg.photo.length - 1];
                        article.imageUrl = photo.file_id;
                    }
                    sent = await (0, telegram_1.safeSendToChannels)(user, targets, async (target) => {
                        const u = { ...user, target_channel: target, extra_channels: '' };
                        await (0, telegram_1.safeSend)(u, article);
                    });
                }
                else {
                    sent = await (0, telegram_1.safeSendToChannels)(user, targets, async (target) => {
                        await bot_instance_1.bot.forwardMessage(target, sourceKey, msg.message_id);
                    });
                }
                if (sent === 0)
                    throw new Error('All Telegram monitor sends failed');
                await this.markMessageSeen(sub.user_id, sourceKey, msg.message_id);
                await database_1.DBService.incrementStat(sub.user_id, 'total_posts');
            }
            catch (e) {
                logger_1.logger.warn(`TG forward failed user ${sub.user_id}: ${e.message}`);
            }
        }
    },
    async verifyBotInSourceChannel(channelInput) {
        try {
            const normalized = normalizeTelegramChannelId(channelInput);
            const chat = await bot_instance_1.bot.getChat(normalized);
            const me = await bot_instance_1.bot.getMe();
            const member = await bot_instance_1.bot.getChatMember(chat.id, me.id);
            if (member.status !== 'administrator' && member.status !== 'creator') {
                return { ok: false, error: 'Bot manba kanalda admin emas' };
            }
            return { ok: true, chatId: String(chat.id), title: chat.title || normalized };
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    },
};
