"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDashboardServer = startDashboardServer;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const dashboard_1 = require("../handlers/dashboard");
function startDashboardServer(port, _bot) {
    const app = (0, express_1.default)();
    app.set('trust proxy', 1);
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    const allowedOrigins = [config_1.CONFIG.PUBLIC_URL || '', 'https://t.me', 'https://telegram.org'].filter(Boolean);
    app.use((req, res, next) => {
        const origin = req.headers.origin || '';
        if (allowedOrigins.includes(origin) || !origin)
            res.header('Access-Control-Allow-Origin', origin || '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-bot-token, x-user-id');
        if (req.method === 'OPTIONS')
            return res.sendStatus(200);
        next();
    });
    app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public'), {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    }));
    app.get('/tonconnect-manifest.json', (req, res) => {
        const publicBase = config_1.CONFIG.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
        res.json({ url: publicBase, name: 'mateAssistent', iconUrl: `${publicBase}/tonconnect-icon.svg`, termsOfUseUrl: `${publicBase}/dashboard`, privacyPolicyUrl: `${publicBase}/dashboard` });
    });
    (0, dashboard_1.registerRoutes)(app);
    app.listen(port, () => logger_1.logger.info(`🖥 Dashboard on ${port}`));
    return app;
}
