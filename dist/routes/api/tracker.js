"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTrackerRoutes = registerTrackerRoutes;
const database_1 = require("../../services/database");
const pricetracker_1 = require("../../services/pricetracker");
const scraper_1 = require("../../services/scraper");
const auth_1 = require("../../middleware/auth");
const logger_1 = require("../../utils/logger");
function registerTrackerRoutes(app) {
    app.get('/api/tracker/search', auth_1.checkAuth, async (req, res) => {
        const q = req.query.q;
        if (!q || typeof q !== 'string' || q.trim() === '')
            return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
        try {
            res.json((await pricetracker_1.PriceTrackerService.searchProducts(q.trim())).sort((a, b) => a.price - b.price));
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/tracker/cheapest', auth_1.checkAuth, async (req, res) => {
        const q = req.query.q;
        if (!q || typeof q !== 'string' || q.trim() === '')
            return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
        try {
            let results = await pricetracker_1.PriceTrackerService.searchProducts(q.trim());
            if (!results.length) {
                try {
                    const scraped = await scraper_1.ScraperService.searchProducts(q.trim());
                    results = (scraped || []).map((item) => ({ title: item.name || item.title || 'Mahsulot', price: Number(item.price) || 0, url: item.url, source: item.store || item.source || 'Marketplace' })).filter((item) => item.url && Number.isFinite(item.price) && item.price > 0).sort((a, b) => a.price - b.price);
                }
                catch (e) {
                    logger_1.logger.warn(`API call failed: ${e?.message || 'unknown error'}`);
                }
            }
            const cheapest = results[0] || null;
            const bySource = Array.from(results.reduce((acc, item) => { const current = acc.get(item.source); if (!current || item.price < current.price)
                acc.set(item.source, item); return acc; }, new Map())).map(([, v]) => v).sort((a, b) => a.price - b.price);
            res.json({ cheapest, bySource });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/prices/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getTrackedPrices(parseInt(req.authenticatedUserId))));
    app.post('/api/prices/:userId', auth_1.checkAuth, async (req, res) => {
        const { url, name, price } = req.body;
        const parsedPrice = Number(price);
        if (!url || !name || Number.isNaN(parsedPrice) || parsedPrice < 0)
            return res.status(400).json({ error: 'Invalid price tracker payload' });
        try {
            let finalName = name, finalPrice = parsedPrice;
            if (finalName === 'Tovar' || finalPrice === 0) {
                const resolved = await pricetracker_1.PriceTrackerService.fetchPrice(url);
                if (resolved) {
                    finalName = resolved.title;
                    finalPrice = resolved.price;
                }
            }
            await database_1.DBService.addTrackedPrice(parseInt(req.authenticatedUserId), url, finalName, finalPrice);
            res.json({ success: true });
        }
        catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.delete('/api/prices/:userId/:id', auth_1.checkAuth, async (req, res) => { await database_1.DBService.removePrice(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });
}
