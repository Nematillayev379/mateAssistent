"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceRoutes = registerWorkspaceRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const database_1 = require("../../services/database");
const workspace_1 = require("../../services/workspace");
const auth_1 = require("../auth");
const logger_1 = require("../../utils/logger");
function registerWorkspaceRoutes(app) {
    const wsLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, max: 30, message: { error: 'Workspace rate limit exceeded.' } });
    app.use('/api/workspaces', wsLimiter);
    // ── Workspace CRUD ──
    app.get('/api/workspaces', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const workspaces = await database_1.DBService.getUserWorkspaces(uid);
        for (const ws of workspaces) {
            ws.channels = await database_1.DBService.getWorkspaceChannels(ws.id);
            ws.members = await database_1.DBService.getWorkspaceMembers(ws.id);
        }
        res.json(workspaces);
    });
    app.post('/api/workspaces', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Workspace name is required' });
        }
        const result = await workspace_1.WorkspaceService.createWorkspace(uid, name.trim());
        if (result.error)
            return res.status(400).json({ error: result.error });
        res.json(result);
    });
    app.delete('/api/workspaces/:id', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const wsId = parseInt(req.params.id);
        const workspaces = await database_1.DBService.getUserWorkspaces(uid);
        const ws = workspaces.find((w) => w.id === wsId);
        if (!ws)
            return res.status(404).json({ error: 'Workspace not found' });
        const { getSupabase } = await Promise.resolve().then(() => __importStar(require('../../repositories/BaseRepository')));
        await getSupabase().from('workspace_channels').delete().eq('workspace_id', wsId);
        await getSupabase().from('workspace_members').delete().eq('workspace_id', wsId);
        await getSupabase().from('workspaces').delete().eq('id', wsId);
        res.json({ success: true });
    });
    // ── Channels in Workspace ──
    app.post('/api/workspaces/:id/channels', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const wsId = parseInt(req.params.id);
        const { channelId, name } = req.body;
        if (!channelId)
            return res.status(400).json({ error: 'channelId required' });
        const result = await workspace_1.WorkspaceService.addChannelToWorkspace(wsId, channelId, name || channelId);
        if (result.error)
            return res.status(400).json({ error: result.error });
        res.json(result);
    });
    app.delete('/api/workspaces/:id/channels/:channelId', auth_1.checkAuth, async (req, res) => {
        const wsId = parseInt(req.params.id);
        await database_1.DBService.removeWorkspaceChannel(req.params.channelId, wsId);
        res.json({ success: true });
    });
    // ── Team Members ──
    app.get('/api/workspaces/:id/members', auth_1.checkAuth, async (req, res) => {
        const wsId = parseInt(req.params.id);
        res.json(await database_1.DBService.getWorkspaceMembers(wsId));
    });
    app.post('/api/workspaces/:id/members', auth_1.checkAuth, async (req, res) => {
        const wsId = parseInt(req.params.id);
        const { userId, role } = req.body;
        if (!userId)
            return res.status(400).json({ error: 'userId required' });
        const ok = await database_1.DBService.addWorkspaceMember(wsId, parseInt(userId), role || 'editor');
        if (!ok)
            return res.status(409).json({ error: 'Member already exists or cannot be added' });
        logger_1.logger.info(`Workspace ${wsId}: member ${userId} added as ${role || 'editor'}`);
        res.json({ success: true });
    });
    app.delete('/api/workspaces/:id/members/:userId', auth_1.checkAuth, async (req, res) => {
        const wsId = parseInt(req.params.id);
        const memberId = parseInt(req.params.userId);
        await database_1.DBService.removeWorkspaceMember(wsId, memberId);
        res.json({ success: true });
    });
    app.patch('/api/workspaces/:id/members/:userId', auth_1.checkAuth, async (req, res) => {
        const wsId = parseInt(req.params.id);
        const memberId = parseInt(req.params.userId);
        const { role } = req.body;
        if (!role)
            return res.status(400).json({ error: 'role required' });
        await database_1.DBService.updateWorkspaceMemberRole(wsId, memberId, role);
        res.json({ success: true });
    });
}
