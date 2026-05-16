import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';
import { DBService } from './database';
import { notify } from './bot_instance';

let isPriceCheckRunning = false;

export const PriceTrackerService = {
  async fetchPrice(url: string): Promise<{ price: number, title: string } | null> {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });

      const $ = cheerio.load(data);
      let price = 0;
      let title = "";

      if (url.includes('uzum.uz')) {
        // Basic Uzum scraper logic (HTML structure might change)
        const priceText = $('[data-test-id="item__price"]').first().text() || $('.product-price').first().text();
        const titleText = $('h1.title').first().text() || $('h1').first().text();
        const priceStr = priceText.split(/[-–]/)[0];
        price = parseInt(priceStr.replace(/[^\d]/g, '')) || 0;
        title = titleText.trim();
      } else if (url.includes('olx.uz')) {
        // Basic OLX scraper logic
        const priceText = $('[data-testid="ad-price"]').first().text();
        const titleText = $('[data-testid="ad-title"]').first().text();
        const priceStr = priceText.split(/[-–]/)[0];
        price = parseInt(priceStr.replace(/[^\d]/g, '')) || 0;
        title = titleText.trim();
      }

      if (price > 0 && title) {
        return { price, title };
      }
      return null;
    } catch (e: any) {
      logger.warn(`Price check failed for ${url}: ${e.message}`);
      return null;
    }
  },

  async searchProducts(query: string): Promise<{ title: string, price: number, url: string, source: string }[]> {
    try {
      // Search on Uzum.uz
      const uzumResults = await this.searchUzum(query);
      // Search on OLX.uz
      const olxResults = await this.searchOLX(query);
      
      return [...uzumResults, ...olxResults];
    } catch (e: any) {
      logger.error(`Price search failed: ${e.message}`);
      return [];
    }
  },

  async searchUzum(query: string): Promise<{ title: string, price: number, url: string, source: string }[]> {
    try {
      const searchUrl = `https://uzum.uz/search?query=${encodeURIComponent(query)}`;
      const { data } = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });
      
      const $ = cheerio.load(data);
      const results: { title: string, price: number, url: string, source: string }[] = [];
      
      // Extract product cards
      $('.product-card, [data-testid="product-card"]').each((i, elem) => {
        if (i >= 5) return; // Limit to 5 results
        const title = $(elem).find('.product-title, [data-testid="product-title"]').text().trim();
        const priceText = $(elem).find('.product-price, [data-testid="product-price"]').text().trim();
        const priceStr = priceText.split(/[-–]/)[0];
        const price = parseInt(priceStr.replace(/[^\d]/g, '')) || 0;
        const link = $(elem).find('a').attr('href');
        
        if (title && price > 0 && link) {
          results.push({
            title,
            price,
            url: link.startsWith('http') ? link : `https://uzum.uz${link}`,
            source: 'Uzum'
          });
        }
      });
      
      return results;
    } catch (e: any) {
      logger.warn(`Uzum search failed: ${e.message}`);
      return [];
    }
  },

  async searchOLX(query: string): Promise<{ title: string, price: number, url: string, source: string }[]> {
    try {
      const searchUrl = `https://www.olx.uz/list/q_${encodeURIComponent(query)}/`;
      const { data } = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });
      
      const $ = cheerio.load(data);
      const results: { title: string, price: number, url: string, source: string }[] = [];
      
      // Extract ad cards
      $('[data-cy="l-card"], .offer-wrapper').each((i, elem) => {
        if (i >= 5) return; // Limit to 5 results
        const title = $(elem).find('h6, [data-testid="ad-title"]').text().trim();
        const priceText = $(elem).find('[data-testid="ad-price"]').text().trim();
        const priceStr = priceText.split(/[-–]/)[0];
        const price = parseInt(priceStr.replace(/[^\d]/g, '')) || 0;
        const link = $(elem).find('a').attr('href');
        
        if (title && link && price > 0) {
          results.push({
            title,
            price,
            url: link.startsWith('http') ? link : `https://www.olx.uz${link}`,
            source: 'OLX'
          });
        }
      });
      
      return results;
    } catch (e: any) {
      logger.warn(`OLX search failed: ${e.message}`);
      return [];
    }
  },

  async runPriceChecks() {
    if (isPriceCheckRunning) return;
    isPriceCheckRunning = true;
    try {
      const items = await DBService.getAllTrackedPrices();
      if (!items || items.length === 0) return;

      logger.info(`🔍 Narxlar tekshirilmoqda (${items.length} ta mahsulot)...`);

      for (const item of items) {
        const result = await this.fetchPrice(item.url);
        if (result) {
          if (result.price < item.price) {
            // Narx tushgan!
            const diff = item.price - result.price;
            try {
              await notify(
                item.user_id,
                `📉 <b>Narx Tushdi!</b>\n\n` +
                `📦 <b>${result.title}</b>\n\n` +
                `💰 Eski narx: ${item.price.toLocaleString()} UZS\n` +
                `🔥 Yangi narx: <b>${result.price.toLocaleString()} UZS</b>\n\n` +
                `🔽 Farq: -${diff.toLocaleString()} UZS\n\n` +
                `🔗 <a href="${item.url}">Sotib olish</a>`,
                { parse_mode: 'HTML' }
              );
            } catch {}
          } else if (result.price > item.price && item.price > 0) {
            // Narx oshgan!
            const diff = result.price - item.price;
            try {
              await notify(
                item.user_id,
                `📈 <b>Narx Oshdi!</b>\n\n` +
                `📦 <b>${result.title}</b>\n\n` +
                `💰 Eski narx: ${item.price.toLocaleString()} UZS\n` +
                `⚠️ Yangi narx: <b>${result.price.toLocaleString()} UZS</b>\n\n` +
                `🔼 Farq: +${diff.toLocaleString()} UZS\n\n` +
                `🔗 <a href="${item.url}">Ko'rish</a>`,
                { parse_mode: 'HTML' }
              );
            } catch {}
          }
          // Always update to current price to avoid spam
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
