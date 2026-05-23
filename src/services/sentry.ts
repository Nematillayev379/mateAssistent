import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger';

let initialized = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry not configured (SENTRY_DSN not set)');
    return;
  }
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    });
    initialized = true;
    logger.info('Sentry initialized');
  } catch (e: any) {
    logger.warn(`Sentry init failed: ${e.message}`);
  }
}

export function captureError(error: any, context?: Record<string, any>) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
}

export function captureMessage(msg: string, level: Sentry.SeverityLevel = 'warning') {
  if (!initialized) return;
  Sentry.captureMessage(msg, level);
}

export default { initSentry, captureError, captureMessage };
