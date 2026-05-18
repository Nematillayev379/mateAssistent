import { logger } from '../utils/logger';
import { DBService } from './database';

const MemoryTransactions: Record<string, { state: number; create_time: number; perform_time: number; cancel_time: number }> = {};

export const PaymentService = {
  // ... (keep generate methods)
  async generatePaymeLink(userId: number, amount: number) {
    const merchantId = process.env.PAYME_MERCHANT_ID;
    if (!merchantId) {
      logger.warn('PAYME_MERCHANT_ID not configured');
      return null;
    }
    const tiyin = Math.round(amount * 100);
    const base64Params = Buffer.from(`m=${merchantId};ac.user_id=${userId};a=${tiyin}`).toString('base64');
    return `https://checkout.paycom.uz/${base64Params}`;
  },

  async generateClickLink(userId: number, amount: number) {
    const serviceId = process.env.CLICK_SERVICE_ID;
    const merchantId = process.env.CLICK_MERCHANT_ID;
    if (!serviceId || !merchantId) {
      logger.warn('CLICK_SERVICE_ID or CLICK_MERCHANT_ID not configured');
      return null;
    }
    return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${userId}`;
  },

  async handlePaymeWebhook(data: any, headers?: any) {
    const paymeKey = process.env.PAYME_KEY;
    if (!paymeKey) {
      logger.error('🚫 Payme: PAYME_KEY not configured. Webhook rejected.');
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
    let parsedUserId: number;
    if (typeof rawUserId === 'object' && rawUserId !== null) {
      parsedUserId = parseInt(String(rawUserId.user_id || rawUserId.id || 0));
    } else if (rawUserId !== undefined && rawUserId !== null) {
      parsedUserId = parseInt(String(rawUserId));
    } else {
      parsedUserId = 0;
    }
    const hasValidUser = !Number.isNaN(parsedUserId) && parsedUserId > 0;
    const baseResult = { id: requestId, jsonrpc: '2.0' };
    const txId = data.params?.id || '';

    switch (method) {
      case 'CheckPerformTransaction':
        return { ...baseResult, result: { allow: true, details: {} } };
      case 'CreateTransaction':
        if (!MemoryTransactions[txId]) {
          MemoryTransactions[txId] = { state: 1, create_time: Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: 0 };
        }
        return { ...baseResult, result: { transaction: { id: txId, create_time: MemoryTransactions[txId].create_time, perform_time: 0, cancel_time: 0, state: MemoryTransactions[txId].state } } };
      case 'PerformTransaction':
        if (!hasValidUser) return { error: { code: -31050, message: 'Invalid account' } };
        if (MemoryTransactions[txId] && MemoryTransactions[txId].state === 1) {
          MemoryTransactions[txId].state = 2;
          MemoryTransactions[txId].perform_time = Math.floor(Date.now() / 1000);
          await DBService.setPremium(parsedUserId, 30);
          logger.info(`✅ Payme: Premium activated for user ${parsedUserId}`);
        } else if (!MemoryTransactions[txId]) {
          MemoryTransactions[txId] = { state: 2, create_time: Math.floor(Date.now() / 1000), perform_time: Math.floor(Date.now() / 1000), cancel_time: 0 };
          await DBService.setPremium(parsedUserId, 30);
          logger.info(`✅ Payme: Premium activated for user ${parsedUserId}`);
        }
        return { ...baseResult, result: { transaction: { id: txId, create_time: MemoryTransactions[txId].create_time, perform_time: MemoryTransactions[txId].perform_time, cancel_time: 0, state: 2 } } };
      case 'CheckTransaction':
        if (!MemoryTransactions[txId]) {
          return { error: { code: -31003, message: 'Transaction not found' } };
        }
        return { ...baseResult, result: { transaction: { id: txId, state: MemoryTransactions[txId].state, create_time: MemoryTransactions[txId].create_time, perform_time: MemoryTransactions[txId].perform_time, cancel_time: MemoryTransactions[txId].cancel_time } } };
      case 'CancelTransaction':
        if (MemoryTransactions[txId]) {
          MemoryTransactions[txId].state = MemoryTransactions[txId].state === 2 ? -2 : -1;
          MemoryTransactions[txId].cancel_time = Math.floor(Date.now() / 1000);
        } else {
          MemoryTransactions[txId] = { state: -1, create_time: Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: Math.floor(Date.now() / 1000) };
        }
        return { ...baseResult, result: { transaction: { id: txId, create_time: MemoryTransactions[txId].create_time, perform_time: MemoryTransactions[txId].perform_time, cancel_time: MemoryTransactions[txId].cancel_time, state: MemoryTransactions[txId].state } } };
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
