import express, { Request, Response } from 'express';
import { DBService } from '../../services/database';
import { RssSearchService } from '../../services/rss_search';
import { checkAuth } from '../auth';
import { logger } from '../../utils/logger';

export function registerTrackerRoutes(app: express.Application) {
  app.get('/api/rss-search/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.params.userId as string);
      if (uid !== parseInt(req.authenticatedUserId as string)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const searches = await RssSearchService.getUserSearches(uid);
      res.json({ searches });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`getSearches error: ${msg}`);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/rss-search/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.params.userId as string);
      if (uid !== parseInt(req.authenticatedUserId as string)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { topic, keywords, maxResults, mode } = req.body;
      if (!topic || !topic.trim()) {
        return res.status(400).json({ error: 'Topic is required' });
      }

      const search = await RssSearchService.createSearch(
        uid,
        topic.trim(),
        keywords || [],
        maxResults || 10,
        mode || 'instant'
      );

      if (mode === 'instant') {
        const results = await RssSearchService.runSearch(search.id as string);
        const user = await DBService.getUser(uid);
        const summary = await RssSearchService.summarizeResults(results, topic, user?.language || 'uz');
        return res.json({ success: true, search, results, summary });
      }

      res.json({ success: true, search, message: 'Search created. Results will be delivered daily.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`createSearch error: ${msg}`);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/rss-search/:userId/:searchId', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.params.userId as string);
      if (uid !== parseInt(req.authenticatedUserId as string)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const deleted = await RssSearchService.deleteSearch(uid, req.params.searchId as string);
      res.json({ success: deleted });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`deleteSearch error: ${msg}`);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/rss-search/:userId/:searchId/run', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.params.userId as string);
      if (uid !== parseInt(req.authenticatedUserId as string)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const results = await RssSearchService.runSearch(req.params.searchId as string);
      const user = await DBService.getUser(uid);
      const search = (await RssSearchService.getUserSearches(uid)).find(s => s.id === (req.params.searchId as string));
      const summary = await RssSearchService.summarizeResults(results, search?.topic || 'Search', user?.language || 'uz');

      res.json({ success: true, results, summary });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`runSearch error: ${msg}`);
      res.status(500).json({ error: 'Server error' });
    }
  });
}
