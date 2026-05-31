"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSourcesRoutes = registerSourcesRoutes;
const database_1 = require("../../services/database");
const scraper_1 = require("../../services/scraper");
const auth_1 = require("../auth");
function registerSourcesRoutes(app) {
    app.get('/api/sources/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserSources(parseInt(req.authenticatedUserId))));
    app.post('/api/sources/:userId', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { name, url, lang } = req.body;
        if (!url || typeof url !== 'string' || !url.startsWith('http'))
            return res.status(400).json({ error: 'Invalid URL' });
        if (!(await scraper_1.ScraperService.isPublicExternalUrl(url)))
            return res.status(400).json({ error: 'Private URLs not allowed' });
        const discovered = await scraper_1.ScraperService.discoverRSS(url);
        if (!discovered)
            return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas' });
        if (!(await database_1.DBService.checkUserLimit(uid, 'sources')))
            return res.status(403).json({ error: 'Limit reached' });
        await database_1.DBService.addSource(uid, name, discovered, lang || 'uz');
        res.json({ success: true });
    });
    app.delete('/api/sources/:userId/:id', auth_1.checkAuth, async (req, res) => {
        const sourceId = parseInt(req.params.id);
        if (!sourceId || sourceId <= 0 || isNaN(sourceId))
            return res.status(400).json({ error: 'Invalid ID' });
        await database_1.DBService.removeSource(parseInt(req.authenticatedUserId), sourceId);
        res.json({ success: true });
    });
}
