import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export type CryptoPaymentRecord = {
  id: string;
  user_id: number;
  amount_uzs: number;
  currency: 'USDT' | 'TON';
  crypto_amount: string;
  wallet_address: string;
  memo: string;
  status: 'pending' | 'paid' | 'expired';
  created_at: number;
  plan: string;
};

export const CryptoPaymentRepository = {
  async create(payment: CryptoPaymentRecord) {
    const { data, error } = await getSupabase().from('crypto_payments').insert(payment).select('*').single();
    if (error) {
      logger.error(`createCryptoPayment error: ${error.message}`);
      return null;
    }
    return data as CryptoPaymentRecord;
  },

  async getById(id: string) {
    const { data, error } = await getSupabase().from('crypto_payments').select('*').eq('id', id).maybeSingle();
    if (error) {
      logger.error(`getCryptoPayment error: ${error.message}`);
      return null;
    }
    return data as CryptoPaymentRecord | null;
  },

  async updateStatus(id: string, status: CryptoPaymentRecord['status']) {
    const { error } = await getSupabase().from('crypto_payments').update({ status }).eq('id', id);
    if (error) {
      logger.error(`updateCryptoPaymentStatus error: ${error.message}`);
      return false;
    }
    return true;
  },
};
