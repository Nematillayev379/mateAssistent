"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoPaymentRepository = void 0;
const BaseRepository_1 = require("./BaseRepository");
const logger_1 = require("../utils/logger");
exports.CryptoPaymentRepository = {
    async create(payment) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('crypto_payments').insert(payment).select('*').single();
        if (error) {
            logger_1.logger.error(`createCryptoPayment error: ${error.message}`);
            return null;
        }
        return data;
    },
    async getById(id) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('crypto_payments').select('*').eq('id', id).maybeSingle();
        if (error) {
            logger_1.logger.error(`getCryptoPayment error: ${error.message}`);
            return null;
        }
        return data;
    },
    async updateStatus(id, status) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('crypto_payments').update({ status }).eq('id', id);
        if (error) {
            logger_1.logger.error(`updateCryptoPaymentStatus error: ${error.message}`);
            return false;
        }
        return true;
    },
    async getWalletClaimByTelegramId(telegramId) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)()
            .from('wallet_claims')
            .select('*')
            .eq('telegram_id', telegramId)
            .maybeSingle();
        if (error) {
            logger_1.logger.error(`getWalletClaimByTelegramId error: ${error.message}`);
            return null;
        }
        return data;
    },
    async getWalletClaimByAddress(walletAddress) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)()
            .from('wallet_claims')
            .select('*')
            .eq('wallet_address', walletAddress)
            .maybeSingle();
        if (error) {
            logger_1.logger.error(`getWalletClaimByAddress error: ${error.message}`);
            return null;
        }
        return data;
    },
    async createWalletClaim(record) {
        const { data, error } = await (0, BaseRepository_1.getSupabase)().from('wallet_claims').insert(record).select('*').single();
        if (error) {
            logger_1.logger.error(`createWalletClaim error: ${error.message}`);
            return null;
        }
        return data;
    },
    async deleteWalletClaim(telegramId) {
        const { error } = await (0, BaseRepository_1.getSupabase)().from('wallet_claims').delete().eq('telegram_id', telegramId);
        if (error) {
            logger_1.logger.error(`deleteWalletClaim error: ${error.message}`);
            return false;
        }
        return true;
    },
};
