import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

const PAYMENTS_FILE = path.join(process.cwd(), 'data', 'crypto_payments.json');
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

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

function loadPayments(): PaymentRequest[] {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
    }
  } catch (e) { logger.error(`crypto_payments.json load: ${(e as Error).message}`); }
  return [];
}

function savePayments(payments: PaymentRequest[]) {
  const dir = path.dirname(PAYMENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(payments, null, 2), 'utf-8');
}

let usdtPrice = 12800;
let tonPriceUsdt = 5;
let lastPriceFetch = 0;

async function refreshPrices() {
  if (Date.now() - lastPriceFetch < 300000) return;
  lastPriceFetch = Date.now();
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=toncoin,tether&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d: any = await r.json();
      if (d.toncoin?.usd) tonPriceUsdt = d.toncoin.usd;
    }
  } catch {}
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d: any = await r.json();
      if (d.rates?.UZS) usdtPrice = d.rates.UZS;
    }
  } catch {}
}

export const CryptoPaymentService = {
  async createRequest(userId: number, plan: string): Promise<PaymentRequest | null> {
    const currency = 'USDT';
    if (!CONFIG.USDT_WALLET && !CONFIG.TON_WALLET) return null;
    await refreshPrices();
    const isYearly = plan === 'yearly';
    const amountUZS = isYearly ? 250000 : 25000;
    const cryptoAmount = (amountUZS / usdtPrice).toFixed(2);
    const walletAddress = CONFIG.USDT_WALLET;
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const payments = loadPayments();
    const req: PaymentRequest = {
      id, userId, amountUZS, currency: 'USDT',
      cryptoAmount, walletAddress,
      memo: `MATE${id}`,
      status: 'pending', createdAt: Date.now(), plan
    };
    payments.push(req);
    savePayments(payments);
    return req;
  },

  async createTonRequest(userId: number, plan: string): Promise<PaymentRequest | null> {
    if (!CONFIG.TON_WALLET) return null;
    await refreshPrices();
    const isYearly = plan === 'yearly';
    const amountUZS = isYearly ? 250000 : 25000;
    const cryptoAmount = (amountUZS / usdtPrice / tonPriceUsdt).toFixed(4);
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const payments = loadPayments();
    const req: PaymentRequest = {
      id, userId, amountUZS, currency: 'TON',
      cryptoAmount, walletAddress: CONFIG.TON_WALLET,
      memo: `MATE${id}`,
      status: 'pending', createdAt: Date.now(), plan
    };
    payments.push(req);
    savePayments(payments);
    return req;
  },

  getRequest(id: string): PaymentRequest | null {
    return loadPayments().find(p => p.id === id) || null;
  },

  getUserPendingRequests(userId: number): PaymentRequest[] {
    return loadPayments().filter(p => p.userId === userId && p.status === 'pending');
  },

  async verifyPayment(id: string): Promise<'paid' | 'pending' | 'not_found'> {
    const payments = loadPayments();
    const req = payments.find(p => p.id === id);
    if (!req) return 'not_found';
    if (req.status === 'paid') return 'paid';
    if (Date.now() - req.createdAt > 86400000) {
      req.status = 'expired';
      savePayments(payments);
      return 'not_found';
    }
    const found = req.currency === 'TON'
      ? await checkTonTransaction(req)
      : await checkUsdtTransaction(req);
    if (found) {
      req.status = 'paid';
      savePayments(payments);
      return 'paid';
    }
    return 'pending';
  },

  markPaid(id: string): boolean {
    const payments = loadPayments();
    const req = payments.find(p => p.id === id);
    if (!req || req.status === 'paid') return false;
    req.status = 'paid';
    savePayments(payments);
    return true;
  },

  getAvailableMethods() {
    return {
      stars: true,
      usdt: !!CONFIG.USDT_WALLET,
      ton: !!CONFIG.TON_WALLET,
    };
  }
};

async function checkTonTransaction(req: PaymentRequest): Promise<boolean> {
  try {
    const url = `https://toncenter.com/api/v2/getTransactions?address=${req.walletAddress}&limit=30`;
    const headers: Record<string, string> = {};
    if (CONFIG.TONCENTER_KEY) headers['X-API-Key'] = CONFIG.TONCENTER_KEY;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const data: any = await r.json();
    if (!data.ok || !data.result) return false;
    for (const tx of data.result) {
      const msg = tx.in_msg;
      if (!msg || !msg.message || msg.destination !== req.walletAddress) continue;
      const decoded = Buffer.from(msg.message, 'base64').toString('utf-8').replace(/\0/g, '').trim();
      if (decoded === req.memo) {
        const value = parseFloat(msg.value) / 1e9;
        const expected = parseFloat(req.cryptoAmount);
        if (Math.abs(value - expected) / expected < 0.05) return true;
      }
    }
  } catch (e) { logger.warn(`TON check error: ${(e as Error).message}`); }
  return false;
}

async function checkUsdtTransaction(req: PaymentRequest): Promise<boolean> {
  try {
    const url = `https://api.trongrid.io/v1/accounts/${req.walletAddress}/transactions/trc20?limit=30&contract_address=${USDT_CONTRACT}&only_to=true`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const data: any = await r.json();
    if (!data.data?.length) return false;
    for (const tx of data.data) {
      const value = parseFloat(tx.value) / 1e6;
      const expected = parseFloat(req.cryptoAmount);
      if (Math.abs(value - expected) / expected < 0.05) {
        const txInfo = await fetch(`https://api.trongrid.io/v1/transactions/${tx.transaction_id}/events`, { signal: AbortSignal.timeout(5000) });
        if (txInfo.ok) {
          const events: any = await txInfo.json();
          for (const ev of (events.data || [])) {
            if (ev.result?.memo?.includes(req.memo)) return true;
          }
        }
      }
    }
  } catch (e) { logger.warn(`USDT check error: ${(e as Error).message}`); }
  return false;
}
