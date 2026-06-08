import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { logger } from '../utils/logger';
import { CONFIG } from '../config/config';
import { registerRoutes } from '../handlers/dashboard';
import TelegramBot from 'node-telegram-bot-api';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../config/swagger';
import { initAnalyticsWS } from './analytics-ws';
import type { Server } from 'http';

export function startDashboardServer(port: number | string, _bot?: TelegramBot) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const allowedOrigins = [CONFIG.PUBLIC_URL || '', 'https://t.me', 'https://telegram.org'].filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization, x-bot-token');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.static(path.join(process.cwd(), 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));

  app.get('/tonconnect-manifest.json', (req, res) => {
    const publicBase = CONFIG.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ url: publicBase, name: 'mateAssistent', iconUrl: `${publicBase}/tonconnect-icon.svg`, termsOfUseUrl: `${publicBase}/dashboard`, privacyPolicyUrl: `${publicBase}/dashboard` });
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'mateAssistent API Docs',
  }));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  registerRoutes(app);

  const server: Server = app.listen(port, () => logger.info(`🖥 Dashboard on ${port}`));
  initAnalyticsWS(server);
  return { app, server };
}
