import express from 'express';
import { DBService } from '../../services/database';
import { RssSearchService } from '../../services/rss_search';
import { checkAuth } from '../auth';
import { logger } from '../../utils/logger';

export function registerTrackerRoutes(app: express.Application) {
  app.get('/api/rss-search/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.params.userId);
      if (uid !== parseInt(req.authenticatedUserId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const searches = await RssSearchService.getUserSearches(uid);
      res.json({ searches });
    } catch (err: any) {
      logger.error(`getSearches error: ${err.message}`);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/rss-search/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.params.userId);
      if (uid !== parseInt(req.authenticatedUserId)) {
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
        const results = await RssSearchService.runSearch(search.id);
        const user = await DBService.getUser(uid);
        const summary = await RssSearchService.summarizeResults(results, topic, user?.language || 'uz');
        return res.json({ success: true, search, results, summary });
      }

      res.json({ success: true, search, message: 'Search created. Results will be delivered daily.' });
    } catch (err: any) {
      logger.error(`createSearch error: ${err.message}`);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/rss-search/:userId/:searchId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.params.userId);
      if (uid !== parseInt(req.authenticatedUserId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const deleted = await RssSearchService.deleteSearch(uid, req.params.searchId);
      res.json({ success: deleted });
    } catch (err: any) {
      logger.error(`deleteSearch error: ${err.message}`);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/rss-search/:userId/:searchId/run', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.params.userId);
      if (uid !== parseInt(req.authenticatedUserId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const results = await RssSearchService.runSearch(req.params.searchId);
      const user = await DBService.getUser(uid);
      const search = (await RssSearchService.getUserSearches(uid)).find(s => s.id === req.params.searchId);
      const summary = await RssSearchService.summarizeResults(results, search?.topic || 'Search', user?.language || 'uz');

      res.json({ success: true, results, summary });
    } catch (err: any) {
      logger.error(`runSearch error: ${err.message}`);
      res.status(500).json({ error: 'Server error' });
    }
  });
}
