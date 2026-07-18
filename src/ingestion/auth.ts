import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * `timingSafeEqual` requires equal-length buffers, so both sides are hashed
 * to a fixed 32 bytes first — this also means an attacker learns nothing
 * from a length mismatch on the raw token.
 */
export function checkBearerToken(req: IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length).trim();
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(expectedToken));
}
