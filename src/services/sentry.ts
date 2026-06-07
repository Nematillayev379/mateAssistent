import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger';
import { SecretManager } from './secret_manager';

let initialized = false;

export function initSentry() {
  const dsn = SecretManager.get('SENTRY_DSN');
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`Sentry init failed: ${msg}`);
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
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
