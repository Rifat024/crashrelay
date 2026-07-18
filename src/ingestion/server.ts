import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { IngestionConfig, Defect } from '../types';
import type { DefectHandler } from '../collectors/processCrash';
import { checkBearerToken } from './auth';
import { applyCors } from './cors';
import { createRateLimiter, type RateLimiter } from './rateLimit';

const MAX_BODY_BYTES = 16 * 1024;

interface ClientErrorPayload {
  message?: string;
  stack?: string;
  url?: string;
  userAgent?: string;
}

function sourceIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface IngestionServerOptions {
  now?: () => Date;
  rateLimiter?: RateLimiter;
}

/**
 * Exposes POST /report for the crashrelay-browser client SDK and GET
 * /health for uptime checks. INGESTION_TOKEN is a public "write key" (like
 * a Sentry DSN, readable in devtools) — its abuse-mitigation is this rate
 * limiter + the dedup pipeline, not confidentiality.
 */
export function createIngestionServer(config: IngestionConfig, handler: DefectHandler, options: IngestionServerOptions = {}): Server {
  const now = options.now ?? (() => new Date());
  const rateLimiter = options.rateLimiter ?? createRateLimiter();

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (applyCors(req, res, config.allowedOrigins)) return;

    if (req.method === 'GET' && req.url === '/health') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }

    if (req.method !== 'POST' || req.url !== '/report') {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (!checkBearerToken(req, config.token)) {
      res.statusCode = 401;
      res.end();
      return;
    }

    if (!rateLimiter.allow(sourceIp(req))) {
      res.statusCode = 429;
      res.end();
      return;
    }

    const raw = await readBody(req);
    if (raw === undefined) {
      res.statusCode = 413;
      res.end();
      return;
    }

    let payload: ClientErrorPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }

    // Respond immediately — the client fired via fetch(keepalive)/sendBeacon and isn't waiting on ticket creation.
    res.statusCode = 202;
    res.end();

    if (payload.message) {
      const defect: Defect = {
        type: 'client-error',
        message: payload.message,
        stack: payload.stack,
        context: { url: payload.url, userAgent: payload.userAgent },
        occurredAt: now().toISOString(),
      };
      void handler(defect);
    }
  });
}
