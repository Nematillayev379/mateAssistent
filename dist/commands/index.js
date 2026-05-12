"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commands = void 0;
exports.registerCommands = registerCommands;
const start_1 = require("./start");
const status_1 = require("./status");
const track_1 = require("./track");
const admin_1 = require("./admin");
exports.commands = [
    start_1.startCommand,
    status_1.statusCommand,
    track_1.trackCommand,
    admin_1.adminCommand,
];
function registerCommands(bot) {
    for (const cmd of exports.commands) {
        bot.onText(cmd.pattern, async (msg, match) => {
            try {
                await cmd.handler(bot, msg, match);
            }
            catch (error) {
                console.error(`Error handling command ${cmd.pattern}:`, error);
            }
        });
    }
}
