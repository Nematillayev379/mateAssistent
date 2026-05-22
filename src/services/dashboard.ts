import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { logger } from '../utils/logger';
import { CONFIG } from '../config/config';
import { registerRoutes } from '../routes/dashboard';

export function startDashboardServer(port: number | string, _bot?: any) {
  const app = express();
  app.use(express.json());

  const allowedOrigins = [CONFIG.PUBLIC_URL || '', 'https://t.me', 'https://telegram.org'].filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (allowedOrigins.includes(origin) || !origin) res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-bot-token, x-user-id');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
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

  registerRoutes(app);

  app.listen(port, () => logger.info(`🖥 Dashboard on ${port}`));
  return app;
}
