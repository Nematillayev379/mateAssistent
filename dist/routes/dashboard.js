"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = registerRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("./api/auth");
const admin_1 = require("./api/admin");
const sources_1 = require("./api/sources");
const settings_1 = require("./api/settings");
const media_1 = require("./api/media");
const ai_1 = require("./api/ai");
const tracker_1 = require("./api/tracker");
const channels_1 = require("./api/channels");
const content_1 = require("./api/content");
const premium_1 = require("./api/premium");
const system_1 = require("./api/system");
const workspace_1 = require("./api/workspace");
const public_api_1 = require("./api/public_api");
function registerRoutes(app) {
    const apiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
        message: { error: 'Too many requests, please try again later.' },
        skip: (req) => req.path === '/api/bot/webhook'
    });
    app.use('/api/', apiLimiter);
    (0, auth_1.registerAuthRoutes)(app);
    (0, admin_1.registerAdminRoutes)(app);
    (0, sources_1.registerSourcesRoutes)(app);
    (0, settings_1.registerSettingsRoutes)(app);
    (0, media_1.registerMediaRoutes)(app);
    (0, ai_1.registerAiRoutes)(app);
    (0, tracker_1.registerTrackerRoutes)(app);
    (0, channels_1.registerChannelsRoutes)(app);
    (0, content_1.registerContentRoutes)(app);
    (0, premium_1.registerPremiumRoutes)(app);
    (0, system_1.registerSystemRoutes)(app);
    (0, workspace_1.registerWorkspaceRoutes)(app);
    (0, public_api_1.registerPublicApiRoutes)(app);
}
