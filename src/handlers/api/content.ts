import express from 'express';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { safeSendToChannels } from '../../services/sender';
import { checkAuth, checkAdmin } from '../auth';

export function registerContentRoutes(app: express.Application) {
  app.post('/api/posts/publish', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { text, imageUrl, channels } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Text required' });
    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const targets = Array.isArray(channels) && channels.length ? channels : DBService.getUserOutputChannels(user);
    if (!targets.length) return res.status(400).json({ error: 'No output channels configured' });
    await safeSendToChannels(user, targets, async (target) => {
      if (imageUrl) await bot.sendPhoto(target, imageUrl, { caption: text, parse_mode: 'HTML' });
      else await bot.sendMessage(target, text, { parse_mode: 'HTML' });
    });
    await DBService.incrementStat(uid, 'total_posts');
    res.json({ success: true, sentTo: targets.length });
  });

  app.post('/api/posts/draft', checkAuth, async (req: any, res: any) => {
    const { title, body, image_url, channels } = req.body;
    if (!body) return res.status(400).json({ error: 'Body required' });
    const draft = await DBService.savePostDraft(parseInt(req.authenticatedUserId), { title, body, image_url, channels });
    res.json({ success: true, draft });
  });

  app.get('/api/posts/drafts/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserPostDrafts(parseInt(req.authenticatedUserId))));

  app.get('/api/tickets/all', checkAdmin, async (req, res) => res.json(await DBService.getTickets()));
  app.get('/api/tickets/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserTickets(parseInt(req.authenticatedUserId))));
  app.post('/api/tickets/:userId', checkAuth, async (req: any, res: any) => {
    const { subject, message } = req.body;
    res.json(await DBService.createTicket(parseInt(req.authenticatedUserId), subject, message));
  });

  app.get('/api/referral/:userId', checkAuth, async (req: any, res: any) => {
    const code = await DBService.ensureReferralCode(parseInt(req.authenticatedUserId));
    const stats = await DBService.getReferralStats(parseInt(req.authenticatedUserId));
    const botMe = await bot.getMe();
    res.json({ code, stats, refLink: `https://t.me/${botMe.username}?start=ref_${code}` });
  });

  app.get('/api/scheduled/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserScheduledPosts(parseInt(req.authenticatedUserId))));
  app.post('/api/scheduled/:userId', checkAuth, async (req: any, res: any) => {
    const { type, content, scheduledAt } = req.body;
    if (!['video', 'audio', 'text'].includes(type) || !content || !scheduledAt || isNaN(Date.parse(scheduledAt))) return res.status(400).json({ error: 'Invalid scheduled post payload' });
    try { await DBService.addScheduledPost(parseInt(req.authenticatedUserId), type, content, scheduledAt); res.json({ success: true }); }
    catch (e: any) { res.status(400).json({ error: 'Invalid scheduled post' }); }
  });
  app.delete('/api/scheduled/:userId/:id', checkAuth, async (req: any, res: any) => { await DBService.cancelScheduledPost(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });

  app.get('/api/rules/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserRules(parseInt(req.authenticatedUserId))));
  app.post('/api/rules/:userId', checkAuth, async (req: any, res: any) => {
    const { trigger, condition, action, actionValue } = req.body;
    if (!['keyword', 'source', 'time', 'category'].includes(trigger) || !condition || !action) return res.status(400).json({ error: 'Invalid rule payload' });
    const ok = await DBService.addRule(parseInt(req.authenticatedUserId), trigger, condition, action, actionValue || '');
    res.json({ success: ok });
  });
  app.patch('/api/rules/:userId/:id', checkAuth, async (req: any, res: any) => {
    const ok = await DBService.toggleRule(parseInt(req.params.id), req.body.isActive !== false);
    res.json({ success: ok });
  });
  app.delete('/api/rules/:userId/:id', checkAuth, async (req: any, res: any) => {
    await DBService.deleteRule(parseInt(req.params.id));
    res.json({ success: true });
  });
  app.get('/api/rules/:userId/suggest', checkAuth, async (req: any, res: any) => {
    const { RuleEngine } = await import('../../services/rule_engine');
    const suggestions = await RuleEngine.suggestRules(parseInt(req.authenticatedUserId));
    res.json(suggestions);
  });

  app.get('/api/workspaces/:userId', checkAuth, async (req: any, res: any) => {
    const workspaces = await DBService.getUserWorkspaces(parseInt(req.authenticatedUserId));
    const result = [];
    for (const ws of workspaces) {
      const channels = await DBService.getWorkspaceChannels(ws.id);
      result.push({ ...ws, channels });
    }
    res.json(result);
  });
  app.post('/api/workspaces/:userId', checkAuth, async (req: any, res: any) => {
    const { WorkspaceService } = await import('../../services/workspace');
    const result = await WorkspaceService.createWorkspace(parseInt(req.authenticatedUserId), req.body.name || 'My Workspace');
    res.status(result.error ? 400 : 200).json(result);
  });
  app.post('/api/workspaces/:userId/:id/channel', checkAuth, async (req: any, res: any) => {
    const { WorkspaceService } = await import('../../services/workspace');
    const result = await WorkspaceService.addChannelToWorkspace(parseInt(req.params.id), req.body.channelId, req.body.name || '');
    res.status(result.error ? 400 : 200).json(result);
  });
  app.delete('/api/workspaces/:userId/:wid/channel/:chId', checkAuth, async (req: any, res: any) => {
    await DBService.removeWorkspaceChannel(req.params.chId, parseInt(req.params.wid));
    res.json({ success: true });
  });
  app.post('/api/workspaces/:userId/:id/rebalance', checkAuth, async (req: any, res: any) => {
    const { WorkspaceService } = await import('../../services/workspace');
    await WorkspaceService.rebalanceContent(parseInt(req.params.id));
    res.json({ success: true });
  });

  app.get('/api/clusters/today', checkAuth, async (req: any, res: any) => {
    const { ClusteringService } = await import('../../services/clustering');
    const data = await ClusteringService.getClusters(req.query.refresh === '1');
    res.json(data);
  });

  app.post('/api/visual/post', checkAuth, async (req: any, res: any) => {
    const { VisualBuilder } = await import('../../services/visual_builder');
    const { title, content, sourceUrl, category } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const image = await VisualBuilder.createPostImage(title, category);
    const caption = VisualBuilder.formatCaption(title, content || '', sourceUrl);
    res.json({ image: image.imageUrl, imageBase64: image.imageBase64, caption });
  });
}
