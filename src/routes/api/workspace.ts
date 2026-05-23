import express from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { WorkspaceService } from '../../services/workspace';
import { checkAuth, checkAdmin } from '../../middleware/auth';
import { logger } from '../../utils/logger';

export function registerWorkspaceRoutes(app: express.Application) {
  const wsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Workspace rate limit exceeded.' } });
  app.use('/api/workspaces', wsLimiter);

  // ── Workspace CRUD ──
  app.get('/api/workspaces', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const workspaces = await DBService.getUserWorkspaces(uid);
    for (const ws of workspaces) {
      ws.channels = await DBService.getWorkspaceChannels(ws.id);
      ws.members = await DBService.getWorkspaceMembers(ws.id);
    }
    res.json(workspaces);
  });

  app.post('/api/workspaces', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }
    const result = await WorkspaceService.createWorkspace(uid, name.trim());
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.delete('/api/workspaces/:id', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const wsId = parseInt(req.params.id);
    const workspaces = await DBService.getUserWorkspaces(uid);
    const ws = workspaces.find((w: any) => w.id === wsId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const { getSupabase } = await import('../../repositories/BaseRepository');
    await getSupabase().from('workspace_channels').delete().eq('workspace_id', wsId);
    await getSupabase().from('workspace_members').delete().eq('workspace_id', wsId);
    await getSupabase().from('workspaces').delete().eq('id', wsId);
    res.json({ success: true });
  });

  // ── Channels in Workspace ──
  app.post('/api/workspaces/:id/channels', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const wsId = parseInt(req.params.id);
    const { channelId, name } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId required' });
    const result = await WorkspaceService.addChannelToWorkspace(wsId, channelId, name || channelId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  app.delete('/api/workspaces/:id/channels/:channelId', checkAuth, async (req: any, res: any) => {
    const wsId = parseInt(req.params.id);
    await DBService.removeWorkspaceChannel(req.params.channelId, wsId);
    res.json({ success: true });
  });

  // ── Team Members ──
  app.get('/api/workspaces/:id/members', checkAuth, async (req: any, res: any) => {
    const wsId = parseInt(req.params.id);
    res.json(await DBService.getWorkspaceMembers(wsId));
  });

  app.post('/api/workspaces/:id/members', checkAuth, async (req: any, res: any) => {
    const wsId = parseInt(req.params.id);
    const { userId, role } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const ok = await DBService.addWorkspaceMember(wsId, parseInt(userId), role || 'editor');
    if (!ok) return res.status(409).json({ error: 'Member already exists or cannot be added' });
    logger.info(`Workspace ${wsId}: member ${userId} added as ${role || 'editor'}`);
    res.json({ success: true });
  });

  app.delete('/api/workspaces/:id/members/:userId', checkAuth, async (req: any, res: any) => {
    const wsId = parseInt(req.params.id);
    const memberId = parseInt(req.params.userId);
    await DBService.removeWorkspaceMember(wsId, memberId);
    res.json({ success: true });
  });

  app.patch('/api/workspaces/:id/members/:userId', checkAuth, async (req: any, res: any) => {
    const wsId = parseInt(req.params.id);
    const memberId = parseInt(req.params.userId);
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'role required' });
    await DBService.updateWorkspaceMemberRole(wsId, memberId, role);
    res.json({ success: true });
  });
}
