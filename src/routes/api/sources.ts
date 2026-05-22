import express from 'express';
import { DBService } from '../../services/database';
import { ScraperService } from '../../services/scraper';
import { checkAuth } from '../../middleware/auth';

export function registerSourcesRoutes(app: express.Application) {
  app.get('/api/sources/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserSources(parseInt(req.authenticatedUserId))));

  app.post('/api/sources/:userId', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { name, url, lang } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });
    if (!(await ScraperService.isPublicExternalUrl(url))) return res.status(400).json({ error: 'Private URLs not allowed' });
    const discovered = await ScraperService.discoverRSS(url);
    if (!discovered) return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas' });
    if (!(await DBService.checkUserLimit(uid, 'sources'))) return res.status(403).json({ error: 'Limit reached' });
    await DBService.addSource(uid, name, discovered, lang || 'uz');
    res.json({ success: true });
  });

  app.delete('/api/sources/:userId/:id', checkAuth, async (req: any, res: any) => {
    const sourceId = parseInt(req.params.id);
    if (!sourceId || sourceId <= 0 || isNaN(sourceId)) return res.status(400).json({ error: 'Invalid ID' });
    await DBService.removeSource(parseInt(req.authenticatedUserId), sourceId);
    res.json({ success: true });
  });
}
