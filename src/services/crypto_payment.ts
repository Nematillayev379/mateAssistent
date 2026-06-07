import crypto from 'crypto';
import { CONFIG } from '../config/config';
import { DBService } from './database';
import { logger } from '../utils/logger';
const USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCzRVZ5F2pD2v4TO';

interface DBPaymentRecord {
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
}

interface CoinGeckoResponse {
  toncoin?: { usd?: number };
}

interface BinanceResponse {
  price?: string;
}

interface ExchangeRateResponse {
  rates?: { UZS?: number };
}

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

function mapPaymentRecord(record: unknown): PaymentRequest | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.user_id !== 'number' ||
    typeof r.amount_uzs !== 'number' ||
    (r.currency !== 'USDT' && r.currency !== 'TON') ||
    typeof r.crypto_amount !== 'string' ||
    typeof r.wallet_address !== 'string' ||
    typeof r.memo !== 'string' ||
    (r.status !== 'pending' && r.status !== 'paid' && r.status !== 'expired') ||
    typeof r.created_at !== 'number' ||
    typeof r.plan !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    userId: r.user_id,
    amountUZS: r.amount_uzs,
    currency: r.currency as 'USDT' | 'TON',
    cryptoAmount: r.crypto_amount,
    walletAddress: r.wallet_address,
    memo: r.memo,
    status: r.status as 'pending' | 'paid' | 'expired',
    createdAt: r.created_at,
    plan: r.plan,
  };
}

let usdtPrice = 12800;
let tonPriceUsdt = 6;
let lastPriceFetch = 0;
let priceFetchPromise: Promise<void> | null = null;

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

function collectStringLeaves(value: unknown, out = new Set<string>()): Set<string> {
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
    for (const nested of Object.values(value as Record<string, unknown>)) collectStringLeaves(nested, out);
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
  return Math.abs(actual - expected) / expected < 0.15;
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
  if (priceFetchPromise) return priceFetchPromise;
  priceFetchPromise = (async () => {
    const now = Date.now();
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=toncoin,tether&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
      if (r.ok) { const d = await r.json() as CoinGeckoResponse; if (d.toncoin?.usd) tonPriceUsdt = d.toncoin.usd; }
    } catch { logger.warn(`CoinGecko price fetch failed`); }
    if (!tonPriceUsdt || tonPriceUsdt === 6) {
      try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT', { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d = await r.json() as BinanceResponse; if (d.price) tonPriceUsdt = parseFloat(d.price); }
      } catch { logger.warn(`Binance price fetch failed`); }
    }
    for (const url of ['https://api.exchangerate-api.com/v4/latest/USD', 'https://open.er-api.com/v6/latest/USD']) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d = await r.json() as ExchangeRateResponse; if (d.rates?.UZS) { usdtPrice = d.rates.UZS; break; } }
      } catch { logger.warn(`Exchange rate fetch failed`); }
    }
    lastPriceFetch = now;
    priceFetchPromise = null;
  })();
  return priceFetchPromise;
}

// Fetch prices on startup so fallback is never stale
refreshPrices();

function apiHeaders(): Record<string, string> {
  return CONFIG.TONCENTER_KEY ? { 'X-API-Key': CONFIG.TONCENTER_KEY } : {};
}

interface TonCenterTransactionsResponse {
  transactions?: Array<Record<string, unknown>>;
}

interface TonCenterEventsResponse {
  events?: Array<Record<string, unknown>>;
}

async function fetchJson(url: string): Promise<TonCenterTransactionsResponse | TonCenterEventsResponse | null> {
  const r = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  return r.json() as Promise<TonCenterTransactionsResponse | TonCenterEventsResponse>;
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
    if (!data || !('transactions' in data)) return false;
    const transactions = data.transactions;
    if (!Array.isArray(transactions)) return false;

    for (const tx of transactions) {
      if (typeof tx !== 'object' || tx === null) continue;
      const msg = (tx as Record<string, unknown>).in_msg;
      if (!msg || typeof msg !== 'object') continue;
      const msgObj = msg as Record<string, unknown>;
      if (msgObj.destination !== req.walletAddress) continue;

      const mc = (typeof msgObj.message_content === 'object' && msgObj.message_content !== null ? msgObj.message_content : {}) as Record<string, unknown>;
      const bodyStr = typeof mc.body === 'string' ? mc.body : null;
      const candidates = collectStringLeaves([
        msgObj.message,
        bodyStr,
        mc.decoded,
        bodyStr && bodyStr.startsWith('te6cc') ? bodyStr : null,
        msgObj.decoded_opcode,
      ]);
      if (!candidates.size && bodyStr) {
        const raw = bodyStr.replace(/\0/g, '').trim();
        if (raw) candidates.add(raw);
      }

      if (memoMatches(candidates, req.memo)) {
        const value = parseFloat(String(msgObj.value)) / 1e9;
        const expected = parseFloat(req.cryptoAmount);
        if (isAmountMatch(value, expected)) return true;
      }
    }
  } catch (e: unknown) { logger.warn(`TON tx check: ${e instanceof Error ? e.message : 'unknown'}`); }
  return false;
}

async function checkUsdtJettonTransaction(req: PaymentRequest): Promise<boolean> {
  try {
    const data = await fetchJson(appendQuery('https://toncenter.com/api/v3/events', {
      account: req.walletAddress,
      limit: 30,
      sort: 'desc',
      start_utime: Math.floor(req.createdAt / 1000) - 300,
    }));
    if (!data || !('events' in data)) return false;
    const events = data.events;
    if (!Array.isArray(events)) return false;

    for (const event of events) {
      if (typeof event !== 'object' || event === null) continue;
      const actions = (event as Record<string, unknown>).actions;
      if (!Array.isArray(actions)) continue;
      for (const action of actions) {
        if (typeof action !== 'object' || action === null) continue;
        const actionObj = action as Record<string, unknown>;
        const transfer = (actionObj.TonTransfer || actionObj.JettonTransfer || actionObj.JettonSwap) as Record<string, unknown> | undefined;
        if (!transfer || transfer.amount === undefined) continue;
        const isUsdt = actionObj.type === 'JettonTransfer' || actionObj.type === 'JettonSwap';
        if (!isUsdt) continue;

        const details = (typeof actionObj.details === 'object' && actionObj.details !== null ? actionObj.details : {}) as Record<string, unknown>;
        const candidates = collectStringLeaves([
          transfer.comment,
          transfer.forward_payload,
          transfer.custom_payload,
          typeof details.comment === 'string' ? details.comment : undefined,
          typeof details.memo === 'string' ? details.memo : undefined,
        ]);

        if (memoMatches(candidates, req.memo)) {
          const value = parseFloat(String(transfer.amount)) / 1e6;
          const expected = parseFloat(req.cryptoAmount);
          if (isAmountMatch(value, expected)) return true;
        }
      }
    }
  } catch (e: unknown) { logger.warn(`USDT Jetton check: ${e instanceof Error ? e.message : 'unknown'}`); }
  return false;
}
