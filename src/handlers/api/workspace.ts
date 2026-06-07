import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { WorkspaceService } from '../../services/workspace';
import { checkAuth, checkAdmin } from '../auth';
import { logger } from '../../utils/logger';

export function registerWorkspaceRoutes(app: express.Application) {
  const wsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Workspace rate limit exceeded.' } });
  app.use('/api/workspaces', wsLimiter);

  // ── Workspace CRUD ──
  app.get('/api/workspaces', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const workspaces = await DBService.getUserWorkspaces(uid) as Array<Record<string, unknown>>;
      for (const ws of workspaces) {
        ws.channels = await DBService.getWorkspaceChannels(ws.id as number);
        ws.members = await DBService.getWorkspaceMembers(ws.id as number);
      }
      res.json(workspaces);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/workspaces failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/workspaces', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const { name } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Workspace name is required' });
      }
      const result = await WorkspaceService.createWorkspace(uid, name.trim());
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/workspaces failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.delete('/api/workspaces/:id', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const wsId = parseInt(req.params.id as string);
      const workspaces = await DBService.getUserWorkspaces(uid);
      const ws = workspaces.find((w: Record<string, unknown>) => w.id === wsId);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      const { getSupabase } = await import('../../repositories/BaseRepository');
      await getSupabase().from('workspace_channels').delete().eq('workspace_id', wsId);
      await getSupabase().from('workspace_members').delete().eq('workspace_id', wsId);
      await getSupabase().from('workspaces').delete().eq('id', wsId);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`DELETE /api/workspaces/:id failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  // ── Channels in Workspace ──
  app.post('/api/workspaces/:id/channels', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const wsId = parseInt(req.params.id as string);
      const { channelId, name } = req.body;
      if (!channelId) return res.status(400).json({ error: 'channelId required' });
      const result = await WorkspaceService.addChannelToWorkspace(wsId, channelId, name || channelId);
      if (result.error) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/workspaces/:id/channels failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.delete('/api/workspaces/:id/channels/:channelId', checkAuth, async (req: Request, res: Response) => {
    try {
      const wsId = parseInt(req.params.id as string);
      await DBService.removeWorkspaceChannel(req.params.channelId as string, wsId);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`DELETE /api/workspaces/:id/channels/:channelId failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  // ── Team Members ──
  app.get('/api/workspaces/:id/members', checkAuth, async (req: Request, res: Response) => {
    try {
      const wsId = parseInt(req.params.id as string);
      res.json(await DBService.getWorkspaceMembers(wsId));
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/workspaces/:id/members failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/workspaces/:id/members', checkAuth, async (req: Request, res: Response) => {
    try {
      const wsId = parseInt(req.params.id as string);
      const { userId, role } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const ok = await DBService.addWorkspaceMember(wsId, parseInt(userId), role || 'editor');
      if (!ok) return res.status(409).json({ error: 'Member already exists or cannot be added' });
      logger.info(`Workspace ${wsId}: member ${userId} added as ${role || 'editor'}`);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/workspaces/:id/members failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.delete('/api/workspaces/:id/members/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const wsId = parseInt(req.params.id as string);
      const memberId = parseInt(req.params.userId as string);
      await DBService.removeWorkspaceMember(wsId, memberId);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`DELETE /api/workspaces/:id/members/:userId failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.patch('/api/workspaces/:id/members/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const wsId = parseInt(req.params.id as string);
      const memberId = parseInt(req.params.userId as string);
      const { role } = req.body;
      if (!role) return res.status(400).json({ error: 'role required' });
      await DBService.updateWorkspaceMemberRole(wsId, memberId, role);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`PATCH /api/workspaces/:id/members/:userId failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });
}
