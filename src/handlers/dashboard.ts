import express from 'express';
import rateLimit from 'express-rate-limit';
import { registerAuthRoutes } from './api/auth';
import { registerAdminRoutes } from './api/admin';
import { registerSourcesRoutes } from './api/sources';
import { registerSettingsRoutes } from './api/settings';
import { registerMediaRoutes } from './api/media';
import { registerAiRoutes } from './api/ai';
import { registerTrackerRoutes } from './api/tracker';
import { registerChannelsRoutes } from './api/channels';
import { registerContentRoutes } from './api/content';
import { registerPremiumRoutes } from './api/premium';
import { registerSystemRoutes } from './api/system';
import { registerWorkspaceRoutes } from './api/workspace';
import { registerPublicApiRoutes } from './api/public_api';
import { registerDashboardRoutes } from './api/dashboard';

export function registerRoutes(app: express.Application) {
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/api/bot/webhook'
  });
  app.use('/api/', apiLimiter);

  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerSourcesRoutes(app);
  registerSettingsRoutes(app);
  registerMediaRoutes(app);
  registerAiRoutes(app);
  registerTrackerRoutes(app);
  registerChannelsRoutes(app);
  registerContentRoutes(app);
  registerPremiumRoutes(app);
  registerSystemRoutes(app);
  registerWorkspaceRoutes(app);
  registerPublicApiRoutes(app);
  registerDashboardRoutes(app);
}
