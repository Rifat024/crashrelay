import { promises as fs } from 'node:fs';
import type { DedupCache, DedupCacheEntry, DedupDecision, TicketRef } from './types';

export async function readCache(path: string): Promise<DedupCache> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.entries !== 'object' || parsed.entries === null) throw new Error('malformed cache');
    return { entries: parsed.entries };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: {} };
    throw new Error(`Could not read dedup cache at ${path}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Writes via a temp file + rename so a reader never observes a partially-written (truncated/corrupt) cache file, even under concurrent access. */
export async function writeCache(path: string, cache: DedupCache): Promise<void> {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, path);
}

export interface DecideOptions {
  cooldownHours: number;
  commentCooldownMinutes: number;
  now?: () => Date;
}

/**
 * Caps tickets to at most one per fingerprint per cooldown window — not "at
 * most one ticket ever". Within the window, a recurrence gets a comment on
 * the existing ticket (throttled separately so a tight crash loop doesn't
 * spam comments either), not a fresh ticket.
 */
export function decide(cache: DedupCache, fp: string, options: DecideOptions): DedupDecision {
  const now = (options.now ?? (() => new Date()))();
  const entry = cache.entries[fp];

  if (!entry || new Date(entry.cooldownUntil) <= now) {
    return { action: 'create' };
  }

  const lastComment = entry.lastCommentAt ? new Date(entry.lastCommentAt) : undefined;
  const commentCooldownMs = options.commentCooldownMinutes * 60 * 1000;
  if (!lastComment || now.getTime() - lastComment.getTime() >= commentCooldownMs) {
    return { action: 'comment', entry };
  }

  return { action: 'skip', entry };
}

export function recordCreate(cache: DedupCache, fp: string, ticket: TicketRef, options: DecideOptions): DedupCache {
  const now = (options.now ?? (() => new Date()))();
  const cooldownUntil = new Date(now.getTime() + options.cooldownHours * 60 * 60 * 1000);
  const entry: DedupCacheEntry = {
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    count: 1,
    cooldownUntil: cooldownUntil.toISOString(),
    ticket,
  };
  return { entries: { ...cache.entries, [fp]: entry } };
}

export function recordSeenAgain(cache: DedupCache, fp: string, options: DecideOptions, commented: boolean): DedupCache {
  const now = (options.now ?? (() => new Date()))();
  const existing = cache.entries[fp];
  if (!existing) return cache;
  const entry: DedupCacheEntry = {
    ...existing,
    lastSeenAt: now.toISOString(),
    count: existing.count + 1,
    lastCommentAt: commented ? now.toISOString() : existing.lastCommentAt,
  };
  return { entries: { ...cache.entries, [fp]: entry } };
}
