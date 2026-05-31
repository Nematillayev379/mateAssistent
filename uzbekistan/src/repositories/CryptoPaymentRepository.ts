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

export type WalletClaimRecord = {
  id?: number;
  telegram_id: number;
  wallet_address: string;
  bonus_days: number;
  claimed_at?: string;
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

  async getWalletClaimByTelegramId(telegramId: number) {
    const { data, error } = await getSupabase()
      .from('wallet_claims')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (error) {
      logger.error(`getWalletClaimByTelegramId error: ${error.message}`);
      return null;
    }
    return data as WalletClaimRecord | null;
  },

  async getWalletClaimByAddress(walletAddress: string) {
    const { data, error } = await getSupabase()
      .from('wallet_claims')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();
    if (error) {
      logger.error(`getWalletClaimByAddress error: ${error.message}`);
      return null;
    }
    return data as WalletClaimRecord | null;
  },

  async createWalletClaim(record: WalletClaimRecord) {
    const { data, error } = await getSupabase().from('wallet_claims').insert(record).select('*').single();
    if (error) {
      logger.error(`createWalletClaim error: ${error.message}`);
      return null;
    }
    return data as WalletClaimRecord;
  },

  async deleteWalletClaim(telegramId: number) {
    const { error } = await getSupabase().from('wallet_claims').delete().eq('telegram_id', telegramId);
    if (error) {
      logger.error(`deleteWalletClaim error: ${error.message}`);
      return false;
    }
    return true;
  },
};
