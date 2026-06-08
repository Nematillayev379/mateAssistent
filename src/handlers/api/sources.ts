import express, { Request, Response } from 'express';
import { DBService } from '../../services/database';
import { ScraperService } from '../../services/scraper';
import { checkAuth } from '../auth';
import { notifySourceAdded } from '../../services/analytics-ws';

export function registerSourcesRoutes(app: express.Application) {
  /**
   * @swagger
   * /api/sources/{userId}:
   *   get:
   *     tags: [Sources]
   *     summary: Get user's RSS sources
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Array of sources
   */
  app.get('/api/sources/:userId', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await DBService.getUserSources(parseInt(req.authenticatedUserId as string))); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  /**
   * @swagger
   * /api/sources/{userId}:
   *   post:
   *     tags: [Sources]
   *     summary: Add a new RSS source
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [url]
   *             properties:
   *               name:
   *                 type: string
   *               url:
   *                 type: string
   *               lang:
   *                 type: string
   *     responses:
   *       200:
   *         description: Source added
   *       400:
   *         description: Invalid URL
   */
  app.post('/api/sources/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const { name, url, lang } = req.body;
      if (!url || typeof url !== 'string' || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });
      if (!(await ScraperService.isPublicExternalUrl(url))) return res.status(400).json({ error: 'Private URLs not allowed' });
      const discovered = await ScraperService.discoverRSS(url);
      if (!discovered) return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas' });
      if (!(await DBService.checkUserLimit(uid, 'sources'))) return res.status(403).json({ error: 'Limit reached' });
      await DBService.addSource(uid, name, discovered, lang || 'uz');
      notifySourceAdded(uid, { name: name || discovered, url: discovered });
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  /**
   * @swagger
   * /api/sources/{userId}/{id}:
   *   delete:
   *     tags: [Sources]
   *     summary: Remove an RSS source
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Source removed
   */
  app.delete('/api/sources/:userId/:id', checkAuth, async (req: Request, res: Response) => {
    try {
      const sourceId = parseInt(req.params.id as string);
      if (!sourceId || sourceId <= 0 || isNaN(sourceId)) return res.status(400).json({ error: 'Invalid ID' });
      await DBService.removeSource(parseInt(req.authenticatedUserId as string), sourceId);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });
}
