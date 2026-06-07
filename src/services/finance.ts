import axios from 'axios';
import { logger } from '../utils/logger';

interface CbuRate {
  Ccy: string;
  Rate: string;
  [key: string]: unknown;
}

interface CoinGeckoPriceResponse {
  bitcoin?: { usd?: number };
  ethereum?: { usd?: number };
  'the-open-network'?: { usd?: number };
}

export class FinanceService {
  private static CACHE: Record<string, { data: unknown, timestamp: number }> = {};
  private static CACHE_TTL = 3600 * 1000; // 1 hour
  private static fetchPromise: Promise<CbuRate[]> | null = null;

  /** Fetch Rates from CBU */
  static async getRates(): Promise<CbuRate[]> {
    const cacheKey = 'CBU_DATA';
    if (this.CACHE[cacheKey] && Date.now() - (this.CACHE[cacheKey].timestamp as number) < this.CACHE_TTL) {
      return this.CACHE[cacheKey].data as CbuRate[];
    }
    if (this.fetchPromise) {
      return this.fetchPromise;
    }
    
    this.fetchPromise = axios.get<CbuRate[]>('https://cbu.uz/uz/arkhiv-kursov-valyut/json/')
      .then(res => {
        this.CACHE[cacheKey] = { data: res.data, timestamp: Date.now() };
        this.fetchPromise = null;
        return res.data;
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`CBU API failed: ${msg}`);
        this.fetchPromise = null;
        return [];
      });
      
    return this.fetchPromise;
  }

  static async getUSDRate(): Promise<number> {
    const rates = await this.getRates();
    const usd = rates.find((v) => v.Ccy === 'USD');
    return usd ? parseFloat(usd.Rate) : 12750; // Updated fallback
  }

  static async getEURRate(): Promise<number> {
    const rates = await this.getRates();
    const eur = rates.find((v) => v.Ccy === 'EUR');
    return eur ? parseFloat(eur.Rate) : 13800; // Updated fallback
  }

  /** Convert common currency strings to UZS numeric value */
  static async convertToUZS(value: number, currency: string): Promise<number> {
    if (!currency) return value;
    const c = currency.toUpperCase().trim();
    // USD variants: USD, $, U.E., У.Е., Y.E.
    if (c === 'USD' || c === '$' || c.startsWith('U.E') || c.startsWith('У.Е') || c.startsWith('Y.E')) {
      const rate = await this.getUSDRate();
      return Math.round(value * rate);
    }
    if (c === 'EUR' || c === '€') {
      const rate = await this.getEURRate();
      return Math.round(value * rate);
    }
    return value; // Assume UZS
  }

  /** Fetch Top Crypto Prices (BTC, ETH, TON) */
  // B-23 Fix: Add caching to prevent rate limit issues
  static async getCryptoPrices(): Promise<Record<string, number>> {
    const cacheKey = 'CRYPTO_PRICES';
    if (this.CACHE[cacheKey] && Date.now() - (this.CACHE[cacheKey].timestamp as number) < this.CACHE_TTL) {
      return this.CACHE[cacheKey].data as Record<string, number>;
    }
    
    try {
      const res = await axios.get<CoinGeckoPriceResponse>('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network&vs_currencies=usd');
      const prices: Record<string, number> = {
        BTC: res.data?.bitcoin?.usd || 0,
        ETH: res.data?.ethereum?.usd || 0,
        TON: res.data?.['the-open-network']?.usd || 0
      };
      this.CACHE[cacheKey] = { data: prices, timestamp: Date.now() };
      return prices;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`Crypto API failed: ${msg}`);
      return (this.CACHE[cacheKey]?.data as Record<string, number>) || {};
    }
  }
}
