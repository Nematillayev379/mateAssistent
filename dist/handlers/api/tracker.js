"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTrackerRoutes = registerTrackerRoutes;
const database_1 = require("../../services/database");
const rss_search_1 = require("../../services/rss_search");
const auth_1 = require("../auth");
const logger_1 = require("../../utils/logger");
function registerTrackerRoutes(app) {
    app.get('/api/rss-search/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.params.userId);
            if (uid !== parseInt(req.authenticatedUserId)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            const searches = await rss_search_1.RssSearchService.getUserSearches(uid);
            res.json({ searches });
        }
        catch (err) {
            logger_1.logger.error(`getSearches error: ${err.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    });
    app.post('/api/rss-search/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.params.userId);
            if (uid !== parseInt(req.authenticatedUserId)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            const { topic, keywords, maxResults, mode } = req.body;
            if (!topic || !topic.trim()) {
                return res.status(400).json({ error: 'Topic is required' });
            }
            const search = await rss_search_1.RssSearchService.createSearch(uid, topic.trim(), keywords || [], maxResults || 10, mode || 'instant');
            if (mode === 'instant') {
                const results = await rss_search_1.RssSearchService.runSearch(search.id);
                const user = await database_1.DBService.getUser(uid);
                const summary = await rss_search_1.RssSearchService.summarizeResults(results, topic, user?.language || 'uz');
                return res.json({ success: true, search, results, summary });
            }
            res.json({ success: true, search, message: 'Search created. Results will be delivered daily.' });
        }
        catch (err) {
            logger_1.logger.error(`createSearch error: ${err.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    });
    app.delete('/api/rss-search/:userId/:searchId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.params.userId);
            if (uid !== parseInt(req.authenticatedUserId)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            const deleted = await rss_search_1.RssSearchService.deleteSearch(uid, req.params.searchId);
            res.json({ success: deleted });
        }
        catch (err) {
            logger_1.logger.error(`deleteSearch error: ${err.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    });
    app.post('/api/rss-search/:userId/:searchId/run', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.params.userId);
            if (uid !== parseInt(req.authenticatedUserId)) {
                return res.status(403).json({ error: 'Forbidden' });
            }
            const results = await rss_search_1.RssSearchService.runSearch(req.params.searchId);
            const user = await database_1.DBService.getUser(uid);
            const search = (await rss_search_1.RssSearchService.getUserSearches(uid)).find(s => s.id === req.params.searchId);
            const summary = await rss_search_1.RssSearchService.summarizeResults(results, search?.topic || 'Search', user?.language || 'uz');
            res.json({ success: true, results, summary });
        }
        catch (err) {
            logger_1.logger.error(`runSearch error: ${err.message}`);
            res.status(500).json({ error: 'Server error' });
        }
    });
}
