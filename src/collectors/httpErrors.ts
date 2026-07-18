import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Defect } from '../types';
import type { DefectHandler } from './processCrash';

export interface HttpErrorOptions {
  now?: () => Date;
}

function buildStatusDefect(req: IncomingMessage, res: ServerResponse, now: () => Date): Defect {
  return {
    type: 'http-5xx',
    message: `HTTP ${res.statusCode} ${req.method ?? 'UNKNOWN'} ${req.url ?? ''}`.trim(),
    context: { method: req.method, url: req.url, statusCode: res.statusCode },
    occurredAt: now().toISOString(),
  };
}

/**
 * Status-code-only detection. Works identically across Express/Connect/
 * Fastify's Node-compat layer because they all share the underlying
 * `ServerResponse` — genuinely framework-agnostic. Does not capture the
 * thrown Error object; use `expressErrorHandler` (or the framework's own
 * error hook) for that.
 */
export function httpStatusMiddleware(handler: DefectHandler, options: HttpErrorOptions = {}) {
  const now = options.now ?? (() => new Date());
  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
    res.on('finish', () => {
      if (res.statusCode >= 500) void handler(buildStatusDefect(req, res, now));
    });
    next();
  };
}

/**
 * Express/Connect-style 4-arg error middleware. Fastify does not support
 * this signature at all — Fastify users must call `reportDefect` directly
 * from `fastify.setErrorHandler()` instead.
 */
export function expressErrorHandler(handler: DefectHandler, options: HttpErrorOptions = {}) {
  const now = options.now ?? (() => new Date());
  return (err: Error, req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
    void handler({
      type: 'http-5xx',
      message: err.message,
      stack: err.stack,
      context: { method: req.method, url: req.url, statusCode: res.statusCode },
      occurredAt: now().toISOString(),
    });
    next(err);
  };
}

/** For frameworks (e.g. Fastify) with their own error-hook signature — call this directly from that hook. */
export function reportDefect(handler: DefectHandler, err: Error, context?: Record<string, string | number | undefined>, options: HttpErrorOptions = {}): void {
  const now = options.now ?? (() => new Date());
  void handler({ type: 'http-5xx', message: err.message, stack: err.stack, context, occurredAt: now().toISOString() });
}
