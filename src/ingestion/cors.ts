import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Reflects the request's Origin header into Access-Control-Allow-Origin
 * only when it's in the configured allowlist. Returns true if this request
 * was a handled OPTIONS preflight (caller should stop processing).
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}
