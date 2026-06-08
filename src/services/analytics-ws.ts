import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from '../utils/logger';
import { DBService } from './database';

let wss: WebSocketServer;
const authenticatedClients = new Map<number, Set<WebSocket>>();

export function initAnalyticsWS(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws/analytics' });

  wss.on('connection', (ws, req) => {
    logger.info('WebSocket client connected to analytics');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth' && msg.userId) {
          const userId = parseInt(msg.userId);
          if (!authenticatedClients.has(userId)) {
            authenticatedClients.set(userId, new Set());
          }
          authenticatedClients.get(userId)!.add(ws);
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          logger.info(`WebSocket authenticated for user ${userId}`);
        }
      } catch (e) {
        logger.warn('WebSocket message parse error');
      }
    });

    ws.on('close', () => {
      for (const [, clients] of authenticatedClients) {
        clients.delete(ws);
      }
      for (const [userId, clients] of authenticatedClients) {
        if (clients.size === 0) authenticatedClients.delete(userId);
      }
    });

    ws.on('error', (err) => {
      logger.warn(`WebSocket error: ${err.message}`);
    });
  });

  logger.info('Analytics WebSocket server initialized');
}

export function broadcastToUser(userId: number, data: Record<string, unknown>) {
  const clients = authenticatedClients.get(userId);
  if (!clients || clients.size === 0) return;

  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function broadcastAnalytics(userId: number) {
  DBService.getStats(userId).then((stats: Record<string, unknown>) => {
    broadcastToUser(userId, {
      type: 'stats_update',
      data: {
        total_posts: (stats.total_posts as number) || 0,
        total_duplicates: (stats.total_duplicates as number) || 0,
        timestamp: Date.now(),
      }
    });
  }).catch(() => {});
}

export function notifyPostSent(userId: number, post: { title: string; channel: string }) {
  broadcastToUser(userId, {
    type: 'new_post',
    data: {
      title: post.title,
      channel: post.channel,
      timestamp: Date.now(),
    }
  });
}

export function notifySourceAdded(userId: number, source: { name: string; url: string }) {
  broadcastToUser(userId, {
    type: 'source_added',
    data: {
      name: source.name,
      url: source.url,
      timestamp: Date.now(),
    }
  });
}

export function notifyDuplicateBlocked(userId: number, title: string) {
  broadcastToUser(userId, {
    type: 'duplicate_blocked',
    data: {
      title,
      timestamp: Date.now(),
    }
  });
}

export function getConnectedUsers(): number[] {
  return Array.from(authenticatedClients.keys());
}
