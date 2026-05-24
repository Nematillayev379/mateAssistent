import express from 'express';
import { DBService } from '../../services/database';
import { PriceTrackerService } from '../../services/pricetracker';
import { ScraperService } from '../../services/scraper';
import { checkAuth } from '../../middleware/auth';
import { logger } from '../../utils/logger';

export function registerTrackerRoutes(app: express.Application) {
  app.get('/api/tracker/search', checkAuth, async (req: any, res: any) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim() === '') return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
    try { res.json((await PriceTrackerService.searchProducts(q.trim())).sort((a: any, b: any) => a.price - b.price)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/tracker/cheapest', checkAuth, async (req: any, res: any) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim() === '') return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
    try {
      let results = await PriceTrackerService.searchProducts(q.trim());
      if (!results.length) {
        try {
          const scraped = await ScraperService.searchProducts(q.trim());
          results = (scraped || []).map((item: any) => ({ title: item.name || item.title || 'Mahsulot', price: Number(item.price) || 0, url: item.url, source: item.store || item.source || 'Marketplace' })).filter((item: any) => item.url && Number.isFinite(item.price) && item.price > 0).sort((a: any, b: any) => a.price - b.price);
        } catch (e: any) { logger.warn(`API call failed: ${e?.message || 'unknown error'}`); }
      }
      const cheapest = results[0] || null;
      const bySource = Array.from(results.reduce((acc: Map<string, any>, item: any) => { const current = acc.get(item.source); if (!current || item.price < current.price) acc.set(item.source, item); return acc; }, new Map())).map(([, v]) => v).sort((a, b) => a.price - b.price);
      res.json({ cheapest, bySource });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/prices/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getTrackedPrices(parseInt(req.authenticatedUserId))));

  app.post('/api/prices/:userId', checkAuth, async (req: any, res: any) => {
    const { url, name, price } = req.body;
    const parsedPrice = Number(price);
    if (!url || !name || Number.isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ error: 'Invalid price tracker payload' });
    try {
      let finalName = name, finalPrice = parsedPrice;
      if (finalName === 'Tovar' || finalPrice === 0) {
        const resolved = await PriceTrackerService.fetchPrice(url);
        if (resolved) { finalName = resolved.title; finalPrice = resolved.price; }
      }
      await DBService.addTrackedPrice(parseInt(req.authenticatedUserId), url, finalName, finalPrice);
      res.json({ success: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/prices/:userId/:id', checkAuth, async (req: any, res: any) => { await DBService.removePrice(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });
}
