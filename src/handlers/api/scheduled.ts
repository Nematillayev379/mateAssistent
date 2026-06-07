import express, { Request, Response } from 'express';
import { z } from 'zod';
import { DBService } from '../../services/database';
import { getSupabase } from '../../repositories/BaseRepository';
import { safeSend } from '../../services/sender';
import { checkAuth } from '../auth';
import { logger } from '../../utils/logger';
import type { ScheduledPost } from '../../types';

const MAX_SCHEDULE_MS = 30 * 24 * 60 * 60 * 1000;

const scheduledAtValidator = z.string().refine((s) => {
  const d = new Date(s);
  const now = Date.now();
  const max = now + MAX_SCHEDULE_MS;
  return d.getTime() > now && d.getTime() <= max;
}, 'scheduledAt must be in future within 30 days');

const ContentSchema = z.object({
  text: z.string().max(4096).optional(),
  url: z.string().url().optional(),
  caption: z.string().max(1024).optional(),
  title: z.string().max(512).optional(),
  imageUrl: z.string().url().optional(),
});

const CreatePostSchema = z.object({
  type: z.enum(['video', 'audio', 'text']),
  content: ContentSchema,
  scheduledAt: scheduledAtValidator,
});

const UpdatePostSchema = z.object({
  scheduledAt: scheduledAtValidator.optional(),
  content: ContentSchema.optional(),
});

type AuthedRequest = Request & { authenticatedUserId?: string };

function requireUserId(req: AuthedRequest, res: Response): number | null {
  const uidStr = req.authenticatedUserId;
  if (!uidStr) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const uid = parseInt(uidStr, 10);
  if (Number.isNaN(uid)) {
    res.status(401).json({ error: 'Invalid user' });
    return null;
  }
  return uid;
}

function parsePostId(idStr: string | string[] | undefined, res: Response): number | null {
  const value = Array.isArray(idStr) ? idStr[0] : idStr;
  if (!value) {
    res.status(400).json({ error: 'Invalid post id' });
    return null;
  }
  const id = parseInt(value, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid post id' });
    return null;
  }
  return id;
}

function validateOrSendError<T>(schema: z.ZodType<T>, data: unknown, res: Response): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    res.status(400).json({ error: 'Validation failed', details: issues });
    return null;
  }
  return result.data;
}

function pickNextPending(posts: ScheduledPost[]): string | null {
  const pending = (posts as Array<{ status: string; scheduled_at: string }>)
    .filter((p) => p.status === 'pending')
    .sort(
      (a, b) =>
        new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
    );
  return pending[0]?.scheduled_at ?? null;
}

export function registerScheduledRoutes(app: express.Application) {
  app.get('/api/scheduled/:userId', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const [posts, stats] = await Promise.all([
        DBService.getUserScheduledPosts(uid),
        DBService.getScheduledPostStats(uid),
      ]);
      const nextPending = pickNextPending(posts as ScheduledPost[]);
      res.json({ posts, stats, nextPending });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/scheduled/:userId failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/scheduled/:userId', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const payload = validateOrSendError(CreatePostSchema, req.body, res);
      if (!payload) return;
      await DBService.addScheduledPost(uid, payload.type, payload.content, payload.scheduledAt);
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/scheduled/:userId failed: ${msg}`);
      res.status(400).json({ error: 'Invalid scheduled post', details: msg });
    }
  });

  app.patch('/api/scheduled/:userId/:id', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const postId = parsePostId(req.params.id, res);
      if (postId === null) return;
      const payload = validateOrSendError(UpdatePostSchema, req.body, res);
      if (!payload) return;
      if (payload.scheduledAt === undefined && payload.content === undefined) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      const existing = await DBService.getScheduledPost(uid, postId);
      if (!existing) return res.status(404).json({ error: 'Post not found' });
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: `Cannot update post in ${existing.status} state` });
      }

      const updates: Record<string, unknown> = {};
      if (payload.scheduledAt !== undefined) updates.scheduled_at = payload.scheduledAt;
      if (payload.content !== undefined) updates.content = payload.content;

      const { error } = await getSupabase()
        .from('scheduled_posts')
        .update(updates)
        .eq('id', postId)
        .eq('user_id', uid);
      if (error) {
        logger.error(`PATCH scheduled_post error: ${error.message}`);
        return res.status(500).json({ error: 'Update failed' });
      }
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`PATCH /api/scheduled/:userId/:id failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.delete('/api/scheduled/:userId/:id', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const postId = parsePostId(req.params.id, res);
      if (postId === null) return;
      const existing = await DBService.getScheduledPost(uid, postId);
      if (!existing) return res.status(404).json({ error: 'Post not found' });
      await DBService.cancelScheduledPost(uid, postId);
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`DELETE /api/scheduled/:userId/:id failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/scheduled/:userId/:id/run-now', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const postId = parsePostId(req.params.id, res);
      if (postId === null) return;
      const post: ScheduledPost | null = await DBService.getScheduledPost(uid, postId);
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.status === 'sent') return res.status(400).json({ error: 'Post already sent' });
      if (post.status === 'cancelled') return res.status(400).json({ error: 'Post was cancelled' });

      const user = await DBService.getUser(uid);
      if (!user) return res.status(404).json({ error: 'User not found' });

      let content: ScheduledPost['content'];
      const rawContent: unknown = post.content;
      if (typeof rawContent === 'string') {
        try {
          content = JSON.parse(rawContent) as ScheduledPost['content'];
        } catch {
          content = { text: rawContent };
        }
      } else {
        content = rawContent as ScheduledPost['content'];
      }

      const article = {
        title: content?.title || (post.type === 'text' ? 'Xabar' : 'Media'),
        content: content?.text || content?.caption || '',
        url: content?.url || '',
        videoUrl: post.type === 'video' ? content?.url : null,
        audioUrl: post.type === 'audio' ? content?.url : null,
        imageUrl: content?.imageUrl,
        emoji: post.type === 'text' ? '📝' : post.type === 'video' ? '📹' : '🎵',
        source: 'Scheduled (manual)',
      };

      try {
        await safeSend(user, article);
      } catch (sendErr: unknown) {
        const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        logger.error(`run-now send failed for post ${postId}: ${sendMsg}`);
        await DBService.updateScheduledPostStatus(postId, 'failed').catch((e: unknown) => {
          const m = e instanceof Error ? e.message : String(e);
          logger.warn(`run-now status update failed: ${m}`);
        });
        return res.status(500).json({ error: 'Send failed', details: sendMsg });
      }
      await DBService.markScheduledPostSent(postId);
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/scheduled/:userId/:id/run-now failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/scheduled/:userId/next', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const posts = await DBService.getUserScheduledPosts(uid);
      const next = pickNextPending(posts as ScheduledPost[]);
      res.json({ nextPending: next });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/scheduled/:userId/next failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/scheduled/:userId/stats', checkAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const uid = requireUserId(req, res);
      if (uid === null) return;
      const stats = await DBService.getScheduledPostStats(uid);
      res.json(stats);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/scheduled/:userId/stats failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });
}
