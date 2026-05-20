import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger, sanitizeLogInput } from '../utils/logger';
import { DBService } from './database';
import { notify } from './bot_instance';

let isPriceCheckRunning = false;

type SearchResult = { title: string, price: number, url: string, source: string };

function cleanPriceText(input: string): number {
  const normalized = String(input || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/(\d[\d\s.,]{2,})/);
  if (!match) return 0;
  const digits = match[1].replace(/[^\d]/g, '');
  const value = parseInt(digits, 10);
  return Number.isFinite(value) ? value : 0;
}

function absoluteUrl(base: string, maybeRelative?: string | null): string | null {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

export const PriceTrackerService = {
  async fetchPrice(url: string): Promise<{ price: number, title: string } | null> {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      const $ = cheerio.load(data);
      $('style').remove();
      $('script').remove();
      let price = 0;
      let title = '';

      if (url.includes('uzum.uz')) {
        const priceText =
          $('[data-test-id="item__price"]').first().text() ||
          $('[data-testid="product-price"]').first().text() ||
          $('[class*="price"]').first().text() ||
          $('meta[property="product:price:amount"]').attr('content') ||
          $('meta[itemprop="price"]').attr('content') ||
          '';
        const titleText =
          $('h1.title').first().text() ||
          $('h1[data-testid="product-title"]').first().text() ||
          $('meta[property="og:title"]').attr('content') ||
          $('h1').first().text();
        price = cleanPriceText(priceText);
        title = titleText.trim();
      } else if (url.includes('olx.uz')) {
        const priceText =
          $('[data-testid="ad-price-container"]').text() ||
          $('[data-testid="ad-price"]').first().text() ||
          $('meta[property="product:price:amount"]').attr('content') ||
          $('meta[itemprop="price"]').attr('content') ||
          $('h3').first().text() ||
          '';
        const titleText =
          $('[data-testid="offer_title"]').text() ||
          $('[data-testid="ad-title"]').first().text() ||
          $('meta[property="og:title"]').attr('content') ||
          $('h1').first().text();
        price = cleanPriceText(priceText);
        title = titleText.trim();
      }

      if (price > 0 && title) {
        return { price, title };
      }
      return null;
    } catch (e: any) {
      logger.warn(`Price check failed for ${sanitizeLogInput(url)}: ${e.message}`);
      return null;
    }
  },

  async searchProducts(query: string): Promise<SearchResult[]> {
    try {
      const [uzumResults, olxResults] = await Promise.all([
        this.searchViaDuckDuckGo('uzum.uz', query, 'Uzum'),
        this.searchViaDuckDuckGo('olx.uz', query, 'OLX'),
      ]);

      const unique = new Map<string, SearchResult>();
      for (const item of [...uzumResults, ...olxResults]) {
        if (!item.url || !item.price) continue;
        if (!unique.has(item.url)) unique.set(item.url, item);
      }
      return Array.from(unique.values());
    } catch (e: any) {
      logger.error(`Price search failed: ${e.message}`);
      return [];
    }
  },

  async searchViaDuckDuckGo(site: string, query: string, source: string): Promise<SearchResult[]> {
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${site} ${query}`)}`;
      const { data } = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 12000
      });

      const $ = cheerio.load(data);
      const links = $('.result .result__a, .web-result .result__a')
        .toArray()
        .map((elem) => {
          const href = $(elem).attr('href');
          const url = absoluteUrl('https://html.duckduckgo.com', href);
          const title = $(elem).text().trim();
          return { url, title };
        })
        .filter((item) => item.url && item.url.includes(site))
        .slice(0, 5) as { url: string; title: string }[];

      const resolved = await Promise.all(
        links.map(async (item) => {
          const priced = await this.fetchPrice(item.url);
          if (!priced) return null;
          return {
            title: priced.title || item.title,
            price: priced.price,
            url: item.url,
            source,
          };
        })
      );

      return resolved.filter((item): item is SearchResult => !!item);
    } catch (e: any) {
      logger.warn(`${source} DDG search failed: ${e.message}`);
      return [];
    }
  },

  async runPriceChecks() {
    if (isPriceCheckRunning) return;
    isPriceCheckRunning = true;
    try {
      const items = await DBService.getAllTrackedPrices();
      if (!items || items.length === 0) return;

      logger.info(`Narxlar tekshirilmoqda (${items.length} ta mahsulot)...`);

      for (const item of items) {
        const result = await this.fetchPrice(item.url);
        if (result) {
          if (result.price < item.price) {
            const diff = item.price - result.price;
            try {
              await notify(
                item.user_id,
                `Narx tushdi!\n\n` +
                `${result.title}\n\n` +
                `Eski narx: ${item.price.toLocaleString()} UZS\n` +
                `Yangi narx: ${result.price.toLocaleString()} UZS\n\n` +
                `Farq: -${diff.toLocaleString()} UZS\n\n` +
                `${item.url}`,
                { parse_mode: 'HTML' }
              );
            } catch {}
          } else if (result.price > item.price && item.price > 0) {
            const diff = result.price - item.price;
            try {
              await notify(
                item.user_id,
                `Narx oshdi!\n\n` +
                `${result.title}\n\n` +
                `Eski narx: ${item.price.toLocaleString()} UZS\n` +
                `Yangi narx: ${result.price.toLocaleString()} UZS\n\n` +
                `Farq: +${diff.toLocaleString()} UZS\n\n` +
                `${item.url}`,
                { parse_mode: 'HTML' }
              );
            } catch {}
          }
          if (result.price !== item.price) {
            await DBService.updatePrice(item.id, result.price);
          }
        }
      }
    } finally {
      isPriceCheckRunning = false;
    }
  }
};
