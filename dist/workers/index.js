"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorkers = startWorkers;
const queue_1 = require("../services/queue");
const logger_1 = require("../utils/logger");
function startWorkers() {
    if (!(0, queue_1.isRedisAvailable)()) {
        logger_1.logger.info('ℹ️ Redis not available — workers skipped, using inline RSS processing');
        return;
    }
    // Workers self-register when imported; guards inside each file prevent
    // Worker construction when REDIS_URL is empty.
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./scraper_worker');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./ai_worker');
        logger_1.logger.info('🚀 Queue workers started');
    }
    catch (err) {
        logger_1.logger.warn(`⚠️ Workers failed to start: ${err.message} — falling back to inline processing`);
    }
}
