import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

const PAYMENTS_FILE = path.join(process.cwd(), 'data', 'crypto_payments.json');
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

function loadPayments(): PaymentRequest[] {
  try {
    if (fs.existsSync(PAYMENTS_FILE)) return JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
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
    if (r.ok) { const d: any = await r.json(); if (d.toncoin?.usd) tonPriceUsdt = d.toncoin.usd; }
  } catch {}
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const d: any = await r.json(); if (d.rates?.UZS) usdtPrice = d.rates.UZS; }
  } catch {}
}

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
    const payments = loadPayments();
    const req: PaymentRequest = {
      id, userId, amountUZS: finalAmount, currency: 'USDT', cryptoAmount,
      walletAddress: CONFIG.TON_WALLET, memo: `MATE${id}`,
      status: 'pending', createdAt: Date.now(), plan
    };
    payments.push(req);
    savePayments(payments);
    return req;
  },

  async createTonRequest(userId: number, plan: string, amountUZS?: number): Promise<PaymentRequest | null> {
    if (!CONFIG.TON_WALLET) return null;
    await refreshPrices();
    const isYearly = plan === 'yearly';
    const finalAmount = amountUZS || (isYearly ? 250000 : 25000);
    const cryptoAmount = (finalAmount / usdtPrice / tonPriceUsdt).toFixed(4);
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const payments = loadPayments();
    const req: PaymentRequest = {
      id, userId, amountUZS: finalAmount, currency: 'TON', cryptoAmount,
      walletAddress: CONFIG.TON_WALLET, memo: `MATE${id}`,
      status: 'pending', createdAt: Date.now(), plan
    };
    payments.push(req);
    savePayments(payments);
    return req;
  },

  getRequest(id: string): PaymentRequest | null {
    return loadPayments().find(p => p.id === id) || null;
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
      : await checkUsdtJettonTransaction(req);
    if (found) {
      req.status = 'paid';
      savePayments(payments);
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
    const data = await fetchJson(`https://toncenter.com/api/v2/getTransactions?address=${req.walletAddress}&limit=30`);
    if (!data?.ok || !data.result) return false;
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
  } catch (e) { logger.warn(`TON tx check: ${(e as Error).message}`); }
  return false;
}

async function checkUsdtJettonTransaction(req: PaymentRequest): Promise<boolean> {
  try {
    const data = await fetchJson(
      `https://toncenter.com/api/v2/getJettonTransfers?address=${req.walletAddress}&jetton_master=${USDT_JETTON_MASTER}&limit=30`
    );
    if (!data?.ok || !data.result) return false;
    for (const tx of data.result) {
      if (tx.to !== req.walletAddress) continue;
      if (tx.comment?.trim() === req.memo) {
        const value = parseFloat(tx.amount) / 1e6;
        const expected = parseFloat(req.cryptoAmount);
        if (Math.abs(value - expected) / expected < 0.05) return true;
      }
    }
  } catch (e) { logger.warn(`USDT Jetton check: ${(e as Error).message}`); }
  return false;
}
