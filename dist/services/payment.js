"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const logger_1 = require("../utils/logger");
const database_1 = require("./database");
exports.PaymentService = {
    // --- STRIPE ---
    async createStripeSession(userId, amount) {
        // This would typically call Stripe API
        // For now, placeholder for implementation
        logger_1.logger.info(`Creating Stripe session for user ${userId}, amount ${amount}`);
        return { url: 'https://checkout.stripe.com/...' };
    },
    // --- PAYME ---
    async generatePaymeLink(userId, amount) {
        const merchantId = process.env.PAYME_MERCHANT_ID || '';
        const base64Params = Buffer.from(`m=${merchantId};ac.user_id=${userId};a=${amount * 100}`).toString('base64');
        return `https://checkout.paycom.uz/${base64Params}`;
    },
    // --- CLICK ---
    async generateClickLink(userId, amount) {
        const serviceId = process.env.CLICK_SERVICE_ID || '';
        const merchantId = process.env.CLICK_MERCHANT_ID || '';
        return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${userId}`;
    },
    // --- WEBHOOK HANDLERS ---
    async handlePaymeWebhook(data) {
        // Verify signature and update DB
        const userId = data.params?.account?.user_id;
        if (userId) {
            await database_1.DBService.setPremium(parseInt(userId), 30);
            logger_1.logger.info(`✅ Payme: Premium activated for user ${userId}`);
        }
        return { result: { success: true } };
    }
};
