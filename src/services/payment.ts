import axios from 'axios';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';
import { DBService } from './database';

export const PaymentService = {
  // --- STRIPE ---
  async createStripeSession(userId: number, amount: number) {
    // This would typically call Stripe API
    // For now, placeholder for implementation
    logger.info(`Creating Stripe session for user ${userId}, amount ${amount}`);
    return { url: 'https://checkout.stripe.com/...' };
  },

  // --- PAYME ---
  async generatePaymeLink(userId: number, amount: number) {
    const merchantId = process.env.PAYME_MERCHANT_ID || '';
    const base64Params = Buffer.from(`m=${merchantId};ac.user_id=${userId};a=${amount * 100}`).toString('base64');
    return `https://checkout.paycom.uz/${base64Params}`;
  },

  // --- CLICK ---
  async generateClickLink(userId: number, amount: number) {
    const serviceId = process.env.CLICK_SERVICE_ID || '';
    const merchantId = process.env.CLICK_MERCHANT_ID || '';
    return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${userId}`;
  },

  // --- WEBHOOK HANDLERS ---
  async handlePaymeWebhook(data: any, headers?: any) {
    // Bug #26 Fix: Verify signature (Basic Auth)
    const auth = headers?.authorization;
    const paymeKey = process.env.PAYME_KEY;
    
    if (paymeKey && auth) {
      const expected = Buffer.from(`Paycom:${paymeKey}`).toString('base64');
      if (auth !== `Basic ${expected}`) {
        logger.warn('🚫 Payme: Invalid signature attempt');
        return { error: { code: -32504, message: "Invalid authorization" } };
      }
    }

    const userId = data.params?.account?.user_id;
    if (userId) {
       await DBService.setPremium(parseInt(userId), 30);
       logger.info(`✅ Payme: Premium activated for user ${userId}`);
    }
    return { result: { success: true } };
  }
};
