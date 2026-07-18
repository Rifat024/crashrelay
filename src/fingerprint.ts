import { createHash } from 'node:crypto';
import type { Defect } from './types';

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ADDR_RE = /\b0x[0-9a-f]{4,}\b/gi;
const ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g;
const LONG_NUMBER_RE = /\b\d{4,}\b/g;

/** Collapses variable data (IDs, timestamps, addresses) so repeated errors with different payloads hash identically. */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, '<uuid>')
    .replace(HEX_ADDR_RE, '<addr>')
    .replace(ISO_TIMESTAMP_RE, '<timestamp>')
    .replace(LONG_NUMBER_RE, '<num>')
    .trim();
}

const STACK_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):\d+:\d+\)?$/;

/**
 * Frames from Node's own internals (`node:internal/...`, event-loop/
 * microtask-queue plumbing like `processTicksAndRejections`). Whether these
 * trail the real stack depends on incidental async/microtask timing at the
 * moment the Error was constructed, not on the actual bug — leaving them in
 * would make the same logical crash hash differently between occurrences
 * and silently defeat dedup.
 */
const INTERNAL_FRAME_RE = /node:internal|\bprocessTicksAndRejections\b|\binternal\/(?:process|timers|modules)\//;

/** Keeps only function name + relative-ish file path from the top N application frames, dropping line/column so unrelated line shifts don't fragment the fingerprint. */
export function normalizeStack(stack: string | undefined, maxFrames = 5): string {
  if (!stack) return '';
  const lines = stack
    .split('\n')
    .slice(1)
    .filter((line) => !INTERNAL_FRAME_RE.test(line))
    .slice(0, maxFrames);
  return lines
    .map((line) => {
      const match = STACK_FRAME_RE.exec(line.trim());
      if (!match) return line.trim();
      const [, fn, file] = match;
      const shortFile = file.split('/').slice(-2).join('/');
      return `${fn ?? '<anonymous>'}@${shortFile}`;
    })
    .join('|');
}

export function fingerprint(defect: Defect): string {
  const parts = [defect.type, normalizeMessage(defect.message), normalizeStack(defect.stack)];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function fingerprintLogLine(matcherId: string, line: string): string {
  return createHash('sha256').update(`${matcherId}|${normalizeMessage(line)}`).digest('hex');
}
