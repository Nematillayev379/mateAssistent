"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const logger_1 = require("../utils/logger");
const database_1 = require("./database");
exports.PaymentService = {
    async generatePaymeLink(userId, amount) {
        const merchantId = process.env.PAYME_MERCHANT_ID;
        if (!merchantId) {
            logger_1.logger.warn('PAYME_MERCHANT_ID not configured');
            return null;
        }
        const tiyin = Math.round(amount * 100);
        const base64Params = Buffer.from(`m=${merchantId};ac.user_id=${userId};a=${tiyin}`).toString('base64');
        return `https://checkout.paycom.uz/${base64Params}`;
    },
    async generateClickLink(userId, amount) {
        const serviceId = process.env.CLICK_SERVICE_ID;
        const merchantId = process.env.CLICK_MERCHANT_ID;
        if (!serviceId || !merchantId) {
            logger_1.logger.warn('CLICK_SERVICE_ID or CLICK_MERCHANT_ID not configured');
            return null;
        }
        return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${userId}`;
    },
    async handlePaymeWebhook(data, headers) {
        const paymeKey = process.env.PAYME_KEY;
        if (!paymeKey) {
            logger_1.logger.error('🚫 Payme: PAYME_KEY not configured. Webhook rejected.');
            return { error: { code: -32504, message: 'Server not configured' } };
        }
        const auth = headers?.authorization;
        if (!auth) {
            return { error: { code: -32504, message: 'Authorization required' } };
        }
        const expected = Buffer.from(`Paycom:${paymeKey}`).toString('base64');
        if (auth !== `Basic ${expected}`) {
            return { error: { code: -32504, message: 'Invalid authorization' } };
        }
        const method = data.method;
        const requestId = data.id ?? data.params?.id ?? 0;
        const rawUserId = data.params?.account?.user_id;
        const parsedUserId = parseInt(String(typeof rawUserId === 'object' && rawUserId !== null ? rawUserId.user_id || rawUserId.id : rawUserId));
        const hasValidUser = !Number.isNaN(parsedUserId);
        const baseResult = { id: requestId, jsonrpc: '2.0' };
        switch (method) {
            case 'CheckPerformTransaction':
                return { ...baseResult, result: { allow: true, details: {} } };
            case 'CreateTransaction':
                return { ...baseResult, result: { transaction: { id: data.params?.id || 0, create_time: Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: 0, state: 1 } } };
            case 'PerformTransaction':
                if (!hasValidUser)
                    return { error: { code: -31050, message: 'Invalid account' } };
                await database_1.DBService.setPremium(parsedUserId, 30);
                logger_1.logger.info(`✅ Payme: Premium activated for user ${parsedUserId}`);
                return { ...baseResult, result: { transaction: { id: data.params?.transaction?.id || 0, create_time: Math.floor(Date.now() / 1000), perform_time: Math.floor(Date.now() / 1000), cancel_time: 0, state: 2 } } };
            case 'CheckTransaction':
                return { ...baseResult, result: { transaction: { id: data.params?.transaction?.id || 0, state: 2, create_time: data.params?.transaction?.create_time || Math.floor(Date.now() / 1000), perform_time: data.params?.transaction?.perform_time || Math.floor(Date.now() / 1000), cancel_time: data.params?.transaction?.cancel_time || 0 } } };
            case 'CancelTransaction':
                return { ...baseResult, result: { transaction: { id: data.params?.transaction?.id || 0, create_time: data.params?.transaction?.create_time || Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: Math.floor(Date.now() / 1000), state: 3 } } };
            default:
                return { error: { code: -32601, message: 'Method not found' } };
        }
    },
    getAvailableMethods() {
        return {
            stars: true,
            payme: !!process.env.PAYME_MERCHANT_ID,
            click: !!(process.env.CLICK_SERVICE_ID && process.env.CLICK_MERCHANT_ID),
        };
    },
};
