import express, { Request, Response } from 'express';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { safeSendToChannels } from '../../services/sender';
import { checkAuth, checkAdmin } from '../auth';

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function registerContentRoutes(app: express.Application) {
  app.post('/api/posts/publish', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const { text, imageUrl, channels } = req.body;
      if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Text required' });
      const user = await DBService.getUser(uid);
      if (!user) return res.status(404).json({ error: 'Not found' });
      const targets = Array.isArray(channels) && channels.length ? channels : DBService.getUserOutputChannels(user);
      if (!targets.length) return res.status(400).json({ error: 'No output channels configured' });
      const escapedText = escapeTelegramHtml(text);
      await safeSendToChannels(user, targets, async (target) => {
        if (imageUrl) await bot.sendPhoto(target, imageUrl, { caption: escapedText, parse_mode: 'HTML' });
        else await bot.sendMessage(target, escapedText, { parse_mode: 'HTML' });
      });
      await DBService.incrementStat(uid, 'total_posts');
      res.json({ success: true, sentTo: targets.length });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/posts/publish-now/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const user = await DBService.getUser(uid);
      if (!user) return res.status(404).json({ error: 'Not found' });
      const targets = DBService.getUserOutputChannels(user);
      if (!targets.length) return res.status(400).json({ error: 'Avval kanal qo\'shing' });

      const titles = await DBService.getRecentNewsTitles(20).catch(() => []);
      const sourceKeyword = (await DBService.getKeywords(uid))[0] || '';
      let picked: string | null = null;
      if (sourceKeyword) {
        picked = titles.find((t: string) => t.toLowerCase().includes(sourceKeyword.toLowerCase())) || null;
      }
      if (!picked) picked = titles[Math.floor(Math.random() * titles.length)] || null;
      if (!picked) return res.status(400).json({ error: 'Hozircha yangiliklar yo\'q' });

      const text = `📰 <b>${picked}</b>\n\n@${(user.username || 'newsroom')}`;
      let sent = 0;
      for (const target of targets) {
        try { await bot.sendMessage(target, text, { parse_mode: 'HTML' }); sent++; } catch { /* skip */ }
        await new Promise(r => setTimeout(r, 100));
      }
      await DBService.incrementStat(uid, 'total_posts');
      res.json({ success: true, sentTo: sent, title: picked });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg });
    }
  });

  app.post('/api/posts/generate/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const user = await DBService.getUser(uid);
      if (!user) return res.status(404).json({ error: 'Not found' });
      const targets = DBService.getUserOutputChannels(user);
      if (!targets.length) return res.status(400).json({ error: 'Avval kanal qo\'shing' });

      const titles = await DBService.getRecentNewsTitles(10).catch(() => []);
      if (!titles.length) return res.status(400).json({ error: 'Yangiliklar yo\'q' });

      const seed = titles[Math.floor(Math.random() * titles.length)];
      const { getSmartAIResponse } = await import('../../services/ai');
      const summary = await getSmartAIResponse(
        'Siz yangiliklar muharriri siz. Qisqa, aniq va o\'zbek tilida 2-3 jumla yozing.',
        `Quyidagi sarlavha asosida qisqa yangilik matni yozing:\n\n${seed}`
      ).catch(() => '');

      const text = `📰 <b>${seed}</b>\n\n${summary || 'Yangilik tafsilotlari tez orada...'}\n\n@${(user.username || 'newsroom')}`;
      let sent = 0;
      for (const target of targets) {
        try { await bot.sendMessage(target, text, { parse_mode: 'HTML' }); sent++; } catch { /* skip */ }
        await new Promise(r => setTimeout(r, 100));
      }
      await DBService.incrementStat(uid, 'total_posts');
      res.json({ success: true, sentTo: sent, title: seed, summary });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg });
    }
  });

  app.post('/api/posts/draft', checkAuth, async (req: Request, res: Response) => {
    try {
      const { title, body, image_url, channels } = req.body;
      if (!body) return res.status(400).json({ error: 'Body required' });
      const draft = await DBService.savePostDraft(parseInt(req.authenticatedUserId as string), { title, body, image_url, channels });
      res.json({ success: true, draft });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/posts/drafts/:userId', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await DBService.getUserPostDrafts(parseInt(req.authenticatedUserId as string))); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/tickets/all', checkAdmin, async (_req: Request, res: Response) => {
    try { res.json(await DBService.getTickets()); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/tickets/:userId', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await DBService.getUserTickets(parseInt(req.authenticatedUserId as string))); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/tickets/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const { subject, message } = req.body;
      res.json(await DBService.createTicket(parseInt(req.authenticatedUserId as string), subject, message));
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/referral/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const code = await DBService.ensureReferralCode(parseInt(req.authenticatedUserId as string));
      const stats = await DBService.getReferralStats(parseInt(req.authenticatedUserId as string));
      const botMe = await bot.getMe();
      res.json({ code, stats, refLink: `https://t.me/${botMe.username}?start=ref_${code}` });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/rules/:userId', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await DBService.getUserRules(parseInt(req.authenticatedUserId as string))); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/rules/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const { trigger, condition, action, actionValue } = req.body;
      if (!['keyword', 'source', 'time', 'category'].includes(trigger) || !condition || !action) return res.status(400).json({ error: 'Invalid rule payload' });
      const ok = await DBService.addRule(parseInt(req.authenticatedUserId as string), trigger, condition, action, actionValue || '');
      res.json({ success: ok });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.patch('/api/rules/:userId/:id', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const rule = await DBService.getRuleById(parseInt(req.params.id as string));
      if (!rule || rule.user_id !== uid) return res.status(403).json({ error: 'Not authorized to modify this rule' });
      const ok = await DBService.toggleRule(parseInt(req.params.id as string), req.body.isActive !== false);
      res.json({ success: ok });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.delete('/api/rules/:userId/:id', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const rule = await DBService.getRuleById(parseInt(req.params.id as string));
      if (!rule || rule.user_id !== uid) return res.status(403).json({ error: 'Not authorized to delete this rule' });
      await DBService.deleteRule(parseInt(req.params.id as string));
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/rules/:userId/suggest', checkAuth, async (req: Request, res: Response) => {
    try {
      const { RuleEngine } = await import('../../services/rule_engine');
      const suggestions = await RuleEngine.suggestRules(parseInt(req.authenticatedUserId as string));
      res.json(suggestions);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/workspaces/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const workspaces = await DBService.getUserWorkspaces(parseInt(req.authenticatedUserId as string));
      const result = [];
      for (const ws of workspaces) {
        const channels = await DBService.getWorkspaceChannels(ws.id);
        result.push({ ...ws, channels });
      }
      res.json(result);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/workspaces/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const { WorkspaceService } = await import('../../services/workspace');
      const result = await WorkspaceService.createWorkspace(parseInt(req.authenticatedUserId as string), req.body.name || 'My Workspace');
      res.status(result.error ? 400 : 200).json(result);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/workspaces/:userId/:id/channel', checkAuth, async (req: Request, res: Response) => {
    try {
      const { WorkspaceService } = await import('../../services/workspace');
      const result = await WorkspaceService.addChannelToWorkspace(parseInt(req.params.id as string), req.body.channelId, req.body.name || '');
      res.status(result.error ? 400 : 200).json(result);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.delete('/api/workspaces/:userId/:wid/channel/:chId', checkAuth, async (req: Request, res: Response) => {
    try {
      await DBService.removeWorkspaceChannel(req.params.chId as string, parseInt(req.params.wid as string));
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/workspaces/:userId/:id/rebalance', checkAuth, async (req: Request, res: Response) => {
    try {
      const { WorkspaceService } = await import('../../services/workspace');
      await WorkspaceService.rebalanceContent(parseInt(req.params.id as string));
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.get('/api/clusters/today', checkAuth, async (req: Request, res: Response) => {
    try {
      const { ClusteringService } = await import('../../services/clustering');
      const data = await ClusteringService.getClusters(req.query.refresh === '1');
      res.json(data);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });

  app.post('/api/visual/post', checkAuth, async (req: Request, res: Response) => {
    try {
      const { VisualBuilder } = await import('../../services/visual_builder');
      const { title, content, sourceUrl, category } = req.body;
      if (!title) return res.status(400).json({ error: 'Title required' });
      const image = await VisualBuilder.createPostImage(title, category);
      const caption = VisualBuilder.formatCaption(title, content || '', sourceUrl);
      res.json({ image: image.imageUrl, imageBase64: image.imageBase64, caption });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : msg }); }
  });
}
