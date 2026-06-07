import { logger } from '../utils/logger';
import { DBService } from './database';
import { SecretManager } from './secret_manager';
import crypto from 'crypto';

interface TxState {
  state: number;
  create_time: number;
  perform_time: number;
  cancel_time: number;
  user_id?: number;
  amount?: number;
  days?: number;
  provider?: 'payme' | 'click';
}

interface PaymeWebhookParams {
  id?: number;
  account?: {
    user_id?: number | { user_id?: number; id?: number };
    days?: number;
  };
  amount?: number;
}

interface PaymeWebhookData {
  method: string;
  id?: number;
  params?: PaymeWebhookParams;
}

interface ClickWebhookPayload {
  click_trans_id?: number | string;
  merchant_trans_id?: string;
  amount?: number | string;
  action?: number | string;
  sign_time?: string;
  sign_string?: string;
  service_id?: number | string;
  error?: number;
  error_note?: string;
}

async function getTx(txId: string): Promise<TxState | null> {
  try {
    const raw = await DBService.getSetting(`pay_tx_${txId}`);
    if (raw) return JSON.parse(raw);
  } catch { logger.warn(`Failed to get tx: parse or read error`); }
  return null;
}

async function saveTx(txId: string, state: TxState) {
  try {
    await DBService.setSetting(`pay_tx_${txId}`, JSON.stringify(state));
  } catch { logger.warn(`Failed to save tx`); }
}

export const PaymentService = {
  async generatePaymeLink(userId: number, amount: number, plan: 'monthly' | 'yearly' = 'monthly') {
    const merchantId = SecretManager.get('PAYME_MERCHANT_ID');
    if (!merchantId) {
      logger.warn('PAYME_MERCHANT_ID not configured');
      return null;
    }
    const days = plan === 'yearly' ? 365 : 30;
    const tiyin = Math.round(amount * 100);
    const base64Params = Buffer.from(`m=${merchantId};ac.user_id=${userId};ac.days=${days};a=${tiyin}`).toString('base64');
    return `https://checkout.paycom.uz/${base64Params}`;
  },

  async generateClickLink(userId: number, amount: number, plan: 'monthly' | 'yearly' = 'monthly') {
    const serviceId = SecretManager.get('CLICK_SERVICE_ID');
    const merchantId = SecretManager.get('CLICK_MERCHANT_ID');
    if (!serviceId || !merchantId) {
      logger.warn('CLICK_SERVICE_ID or CLICK_MERCHANT_ID not configured');
      return null;
    }
    const days = plan === 'yearly' ? 365 : 30;
    const merchantTransId = `premium_${userId}_${days}_${Date.now()}`;
    const tx: TxState = {
      state: 1,
      create_time: Math.floor(Date.now() / 1000),
      perform_time: 0,
      cancel_time: 0,
      user_id: userId,
      amount,
      days,
      provider: 'click',
    };
    await saveTx(merchantTransId, tx);
    return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${merchantTransId}`;
  },

  async handlePaymeWebhook(data: PaymeWebhookData, headers?: { authorization?: string }) {
    const paymeKey = SecretManager.get('PAYME_KEY');
    if (!paymeKey) {
      logger.error('PAYME_KEY not configured. Webhook rejected.');
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
    const txId = String(data.params?.id || '');
    const rawUserId = data.params?.account?.user_id;
    let parsedUserId: number;
    if (typeof rawUserId === 'object' && rawUserId !== null) {
      const nested = rawUserId.user_id || rawUserId.id;
      if (nested) {
        parsedUserId = parseInt(String(nested));
      } else {
        parsedUserId = 0;
      }
    } else if (rawUserId !== undefined && rawUserId !== null) {
      parsedUserId = parseInt(String(rawUserId));
    } else {
      parsedUserId = 0;
    }
    const hasValidUser = !Number.isNaN(parsedUserId) && parsedUserId > 0;
    const baseResult = { id: requestId, jsonrpc: '2.0' };

    switch (method) {
      case 'CheckPerformTransaction': {
        const amount = data.params?.amount;
        const minAmount = 2500000; // 25,000 UZS in tiyin
        if (!amount || amount < minAmount) {
          return { error: { code: -31001, message: 'Incorrect amount' } };
        }
        return { ...baseResult, result: { allow: true, details: {} } };
      }
      case 'CreateTransaction': {
        let tx = await getTx(txId);
        if (!tx) {
          tx = { state: 1, create_time: Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: 0 };
          await saveTx(txId, tx);
        }
        return { ...baseResult, result: { transaction: { id: txId, create_time: tx.create_time, perform_time: 0, cancel_time: 0, state: tx.state } } };
      }
      case 'PerformTransaction': {
        if (!hasValidUser) return { error: { code: -31050, message: 'Invalid account' } };
        const requestedDays = parseInt(String(data.params?.account?.days || 30), 10);
        const days = Number.isNaN(requestedDays) ? 30 : (requestedDays >= 365 ? 365 : 30);
        let tx = await getTx(txId);
        if (tx && tx.state === 2) {
          return { ...baseResult, result: { transaction: { id: txId, create_time: tx.create_time, perform_time: tx.perform_time, cancel_time: 0, state: 2 } } };
        }
        if (!tx) {
          tx = { state: 1, create_time: Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: 0 };
          await saveTx(txId, tx);
        }
        tx.state = 2;
        tx.perform_time = Math.floor(Date.now() / 1000);
        tx.user_id = parsedUserId;
        tx.days = days;
        tx.amount = Number(data.params?.amount || 0) / 100;
        tx.provider = 'payme';
        await saveTx(txId, tx);
        await DBService.setPremium(parsedUserId, days);
        logger.info(`✅ Payme: Premium activated for user ${parsedUserId} (${days} days)`);
        return { ...baseResult, result: { transaction: { id: txId, create_time: tx.create_time, perform_time: tx.perform_time, cancel_time: 0, state: 2 } } };
      }
      case 'CheckTransaction': {
        const tx = await getTx(txId);
        if (!tx) {
          return { error: { code: -31003, message: 'Transaction not found' } };
        }
        return { ...baseResult, result: { transaction: { id: txId, state: tx.state, create_time: tx.create_time, perform_time: tx.perform_time, cancel_time: tx.cancel_time } } };
      }
      case 'CancelTransaction': {
        let tx = await getTx(txId);
        if (tx) {
          tx.state = tx.state === 2 ? -2 : -1;
          tx.cancel_time = Math.floor(Date.now() / 1000);
          await saveTx(txId, tx);
        } else {
          tx = { state: -1, create_time: Math.floor(Date.now() / 1000), perform_time: 0, cancel_time: Math.floor(Date.now() / 1000) };
          await saveTx(txId, tx);
        }
        return { ...baseResult, result: { transaction: { id: txId, create_time: tx.create_time, perform_time: tx.perform_time, cancel_time: tx.cancel_time, state: tx.state } } };
      }
      default:
        return { error: { code: -32601, message: 'Method not found' } };
    }
  },

  getAvailableMethods() {
    return {
      stars: true,
      payme: !!SecretManager.get('PAYME_MERCHANT_ID'),
      click: !!(SecretManager.get('CLICK_SERVICE_ID') && SecretManager.get('CLICK_MERCHANT_ID')),
    };
  },

  async handleClickWebhook(payload: ClickWebhookPayload) {
    const secret = SecretManager.get('CLICK_SECRET_KEY');
    const serviceId = SecretManager.get('CLICK_SERVICE_ID');
    if (!secret || !serviceId) {
      return { error: -9, error_note: 'Payment provider not configured', click_trans_id: payload?.click_trans_id || 0, merchant_trans_id: payload?.merchant_trans_id || '' };
    }

    const clickTransId = String(payload?.click_trans_id || '');
    const merchantTransId = String(payload?.merchant_trans_id || '');
    const amount = String(payload?.amount || '');
    const action = String(payload?.action || '');
    const signTime = String(payload?.sign_time || '');
    const signString = String(payload?.sign_string || '');
    const service = String(payload?.service_id || '');
    const error = Number(payload?.error || 0);

    if (!clickTransId || !merchantTransId || !signTime || !signString) {
      return { error: -8, error_note: 'Invalid request', click_trans_id: clickTransId || 0, merchant_trans_id: merchantTransId || '' };
    }
    if (service !== String(serviceId)) {
      return { error: -1, error_note: 'Invalid service_id', click_trans_id: clickTransId, merchant_trans_id: merchantTransId };
    }

    const expectedSign = crypto
      .createHash('md5')
      .update(`${clickTransId}${serviceId}${secret}${merchantTransId}${amount}${action}${signTime}`)
      .digest('hex');
    if (expectedSign.toLowerCase() !== signString.toLowerCase()) {
      return { error: -1, error_note: 'Invalid signature', click_trans_id: clickTransId, merchant_trans_id: merchantTransId };
    }

    const tx = await getTx(merchantTransId);
    if (!tx) {
      return { error: -5, error_note: 'Transaction not found', click_trans_id: clickTransId, merchant_trans_id: merchantTransId };
    }
    if (error < 0) {
      tx.state = -1;
      tx.cancel_time = Math.floor(Date.now() / 1000);
      await saveTx(merchantTransId, tx);
      return { error: error, error_note: String(payload?.error_note || 'Cancelled'), click_trans_id: clickTransId, merchant_trans_id: merchantTransId };
    }

    if (action === '0') {
      return { error: 0, error_note: 'Success', click_trans_id: clickTransId, merchant_trans_id: merchantTransId, merchant_prepare_id: merchantTransId };
    }

    if (action === '1') {
      if (tx.state !== 2) {
        tx.state = 2;
        tx.perform_time = Math.floor(Date.now() / 1000);
        await saveTx(merchantTransId, tx);
        if (tx.user_id) {
          await DBService.setPremium(tx.user_id, tx.days || 30);
          logger.info(`✅ Click: Premium activated for user ${tx.user_id} (${tx.days || 30} days)`);
        }
      }
      return { error: 0, error_note: 'Success', click_trans_id: clickTransId, merchant_trans_id: merchantTransId, merchant_confirm_id: merchantTransId };
    }

    return { error: -8, error_note: 'Unknown action', click_trans_id: clickTransId, merchant_trans_id: merchantTransId };
  },
};
