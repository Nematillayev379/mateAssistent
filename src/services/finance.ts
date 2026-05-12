import axios from 'axios';
import { logger } from '../utils/logger';

export class FinanceService {
  private static CACHE: Record<string, { data: any, timestamp: number }> = {};
  private static CACHE_TTL = 3600 * 1000; // 1 hour

  /** Fetch Rates from CBU */
  static async getRates(): Promise<any[]> {
    const cacheKey = 'CBU_DATA';
    if (this.CACHE[cacheKey] && Date.now() - this.CACHE[cacheKey].timestamp < this.CACHE_TTL) {
      return this.CACHE[cacheKey].data;
    }
    try {
      const res = await axios.get('https://cbu.uz/uz/arkhiv-kursov-valyut/json/');
      this.CACHE[cacheKey] = { data: res.data, timestamp: Date.now() };
      return res.data;
    } catch (e: any) {
      logger.warn(`CBU API failed: ${e.message}`);
      return [];
    }
  }

  static async getUSDRate(): Promise<number> {
    const rates = await this.getRates();
    const usd = rates.find((v: any) => v.Ccy === 'USD');
    return usd ? parseFloat(usd.Rate) : 12850; // Fallback
  }

  static async getEURRate(): Promise<number> {
    const rates = await this.getRates();
    const eur = rates.find((v: any) => v.Ccy === 'EUR');
    return eur ? parseFloat(eur.Rate) : 13500; // Fallback
  }

  /** Convert common currency strings to UZS numeric value */
  static async convertToUZS(value: number, currency: string): Promise<number> {
    if (!currency) return value;
    const c = currency.toUpperCase().trim();
    // USD variants: USD, $, U.E, UYE, y.e
    if (c === 'USD' || c === '$' || c === 'U.E.' || c === 'У.Е.' || c === 'UYE' || c === 'Y.E.' || c === 'Y.E') {
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
  static async getCryptoPrices(): Promise<Record<string, number>> {
    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network&vs_currencies=usd');
      return {
        BTC: res.data.bitcoin.usd,
        ETH: res.data.ethereum.usd,
        TON: res.data['the-open-network'].usd
      };
    } catch (e: any) {
      logger.error(`Crypto API failed: ${e.message}`);
      return {};
    }
  }
}
