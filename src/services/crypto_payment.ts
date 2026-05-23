import crypto from 'crypto';
import { CONFIG } from '../config/config';
import { DBService } from './database';
import { logger } from '../utils/logger';
const USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCzRVZ5F2pD2v4TO';

interface PaymentRequest {
  id: string;
  userId: number;
  amountUZS: number;
  currency: 'USDT' | 'TON';
  cryptoAmount: string;
  walletAddress: string;
  memo: string;
  status: 'pending' | 'paid' | 'expired';
  createdAt: number;
  plan: string;
}

function mapPaymentRecord(record: any): PaymentRequest | null {
  if (!record) return null;
  return {
    id: record.id,
    userId: record.user_id,
    amountUZS: record.amount_uzs,
    currency: record.currency,
    cryptoAmount: record.crypto_amount,
    walletAddress: record.wallet_address,
    memo: record.memo,
    status: record.status,
    createdAt: record.created_at,
    plan: record.plan,
  };
}

let usdtPrice = 12800;
let tonPriceUsdt = 5;
let lastPriceFetch = 0;

function normalizeMemo(value: string): string {
  return value.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
}

function tryDecodeBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value) || value.length < 8) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const cleaned = normalizeMemo(decoded);
    return cleaned || null;
  } catch {
    return null;
  }
}

function tryDecodeHex(value: string): string | null {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 8 || hex.length % 2 !== 0) return null;
  try {
    const decoded = Buffer.from(hex, 'hex').toString('utf-8');
    const cleaned = normalizeMemo(decoded);
    return cleaned || null;
  } catch {
    return null;
  }
}

function collectStringLeaves(value: any, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const cleaned = normalizeMemo(value);
    if (cleaned) out.add(cleaned);
    const b64 = tryDecodeBase64(value);
    if (b64) out.add(b64);
    const hex = tryDecodeHex(value);
    if (hex) out.add(hex);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, out);
    return out;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) collectStringLeaves(nested, out);
  }

  return out;
}

function memoMatches(candidateValues: Iterable<string>, expectedMemo: string): boolean {
  const expected = normalizeMemo(expectedMemo);
  for (const value of candidateValues) {
    const normalized = normalizeMemo(value);
    if (!normalized) continue;
    if (normalized === expected || normalized.includes(expected)) return true;
  }
  return false;
}

function isAmountMatch(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0) return false;
  return Math.abs(actual - expected) / expected < 0.05;
}

function appendQuery(url: string, params: Record<string, string | number | undefined>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

async function refreshPrices() {
  if (Date.now() - lastPriceFetch < 300000) return;
  lastPriceFetch = Date.now();
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=toncoin,tether&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const d: any = await r.json(); if (d.toncoin?.usd) tonPriceUsdt = d.toncoin.usd; }
  } catch {}
  for (const url of ['https://api.exchangerate-api.com/v4/latest/USD', 'https://open.er-api.com/v6/latest/USD']) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) { const d: any = await r.json(); if (d.rates?.UZS) { usdtPrice = d.rates.UZS; break; } }
    } catch {}
  }
}

// Fetch prices on startup so fallback is never stale
refreshPrices();

function apiHeaders(): Record<string, string> {
  return CONFIG.TONCENTER_KEY ? { 'X-API-Key': CONFIG.TONCENTER_KEY } : {};
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  return r.json();
}

export const CryptoPaymentService = {
  async createRequest(userId: number, plan: string, amountUZS?: number): Promise<PaymentRequest | null> {
    if (!CONFIG.TON_WALLET) return null;
    await refreshPrices();
    const isYearly = plan === 'yearly';
    const finalAmount = amountUZS || (isYearly ? 250000 : 25000);
    const cryptoAmount = (finalAmount / usdtPrice).toFixed(2);
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const req: PaymentRequest = {
      id, userId, amountUZS: finalAmount, currency: 'USDT', cryptoAmount,
      walletAddress: CONFIG.TON_WALLET, memo: `MATE${id}`,
      status: 'pending', createdAt: Date.now(), plan
    };
    const created = await DBService.createCryptoPayment({
      id: req.id,
      user_id: req.userId,
      amount_uzs: req.amountUZS,
      currency: req.currency,
      crypto_amount: req.cryptoAmount,
      wallet_address: req.walletAddress,
      memo: req.memo,
      status: req.status,
      created_at: req.createdAt,
      plan: req.plan,
    });
    return created ? req : null;
  },

  async createTonRequest(userId: number, plan: string, amountUZS?: number): Promise<PaymentRequest | null> {
    if (!CONFIG.TON_WALLET) return null;
    await refreshPrices();
    const isYearly = plan === 'yearly';
    const finalAmount = amountUZS || (isYearly ? 250000 : 25000);
    const cryptoAmount = (finalAmount / usdtPrice / tonPriceUsdt).toFixed(4);
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const req: PaymentRequest = {
      id, userId, amountUZS: finalAmount, currency: 'TON', cryptoAmount,
      walletAddress: CONFIG.TON_WALLET, memo: `MATE${id}`,
      status: 'pending', createdAt: Date.now(), plan
    };
    const created = await DBService.createCryptoPayment({
      id: req.id,
      user_id: req.userId,
      amount_uzs: req.amountUZS,
      currency: req.currency,
      crypto_amount: req.cryptoAmount,
      wallet_address: req.walletAddress,
      memo: req.memo,
      status: req.status,
      created_at: req.createdAt,
      plan: req.plan,
    });
    return created ? req : null;
  },

  async getRequest(id: string): Promise<PaymentRequest | null> {
    return mapPaymentRecord(await DBService.getCryptoPayment(id));
  },

  async verifyPayment(id: string): Promise<'paid' | 'pending' | 'not_found'> {
    const req = mapPaymentRecord(await DBService.getCryptoPayment(id));
    if (!req) return 'not_found';
    if (req.status === 'paid') return 'paid';
    if (Date.now() - req.createdAt > 86400000) {
      await DBService.updateCryptoPaymentStatus(id, 'expired');
      return 'not_found';
    }
    const found = req.currency === 'TON'
      ? await checkTonTransaction(req)
      : await checkUsdtJettonTransaction(req);
    if (found) {
      await DBService.updateCryptoPaymentStatus(id, 'paid');
      return 'paid';
    }
    return 'pending';
  },

  getAvailableMethods() {
    return {
      stars: true,
      usdt: !!CONFIG.TON_WALLET,
      ton: !!CONFIG.TON_WALLET,
    };
  }
};

async function checkTonTransaction(req: PaymentRequest): Promise<boolean> {
  try {
    const data = await fetchJson(appendQuery('https://toncenter.com/api/v3/transactions', {
      account: req.walletAddress,
      limit: 30,
      sort: 'desc',
      start_utime: Math.floor(req.createdAt / 1000) - 300,
    }));
    const transactions = data?.transactions;
    if (!Array.isArray(transactions)) return false;

    for (const tx of transactions) {
      const msg = tx?.in_msg;
      if (!msg || msg.destination !== req.walletAddress) continue;

      const candidates = collectStringLeaves([
        msg.message,
        msg.message_content?.body,
        msg.message_content?.decoded,
        msg.decoded_opcode,
      ]);

      if (memoMatches(candidates, req.memo)) {
        const value = parseFloat(msg.value) / 1e9;
        const expected = parseFloat(req.cryptoAmount);
        if (isAmountMatch(value, expected)) return true;
      }
    }
  } catch (e) { logger.warn(`TON tx check: ${(e as Error).message}`); }
  return false;
}

async function checkUsdtJettonTransaction(req: PaymentRequest): Promise<boolean> {
  try {
    const data = await fetchJson(appendQuery('https://toncenter.com/api/v3/jetton/transfers', {
      owner_address: req.walletAddress,
      jetton_master: USDT_JETTON_MASTER,
      direction: 'in',
      limit: 30,
      sort: 'desc',
      start_utime: Math.floor(req.createdAt / 1000) - 300,
    }));
    const transfers = data?.jetton_transfers;
    if (!Array.isArray(transfers)) return false;

    for (const tx of transfers) {
      if (tx.transaction_aborted) continue;

      const candidates = collectStringLeaves([
        tx.comment,
        tx.forward_payload,
        tx.custom_payload,
        tx.decoded_forward_payload,
        tx.decoded_custom_payload,
      ]);

      if (memoMatches(candidates, req.memo)) {
        const value = parseFloat(tx.amount) / 1e6;
        const expected = parseFloat(req.cryptoAmount);
        if (isAmountMatch(value, expected)) return true;
      }
    }
  } catch (e) { logger.warn(`USDT Jetton check: ${(e as Error).message}`); }
  return false;
}
