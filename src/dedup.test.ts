import assert from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCache, writeCache, decide, recordCreate, recordSeenAgain } from './dedup';
import type { DedupCache, TicketRef } from './types';

const ticket: TicketRef = { provider: 'jira', id: 'OPS-1', url: 'https://x.atlassian.net/browse/OPS-1' };
const opts = (now: Date) => ({ cooldownHours: 24, commentCooldownMinutes: 60, now: () => now });

test('readCache returns empty entries when the file does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cr-dedup-'));
  try {
    const cache = await readCache(join(dir, 'missing.json'));
    assert.deepEqual(cache, { entries: {} });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeCache then readCache round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cr-dedup-'));
  try {
    const path = join(dir, 'cache.json');
    const cache = recordCreate({ entries: {} }, 'fp1', ticket, opts(new Date('2026-07-18T10:00:00Z')));
    await writeCache(path, cache);
    const read = await readCache(path);
    assert.equal(read.entries.fp1.ticket.id, 'OPS-1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('decide: no entry -> create', () => {
  const cache: DedupCache = { entries: {} };
  const decision = decide(cache, 'fp1', opts(new Date('2026-07-18T10:00:00Z')));
  assert.equal(decision.action, 'create');
});

test('decide: within cooldown, no recent comment -> comment', () => {
  let cache: DedupCache = { entries: {} };
  cache = recordCreate(cache, 'fp1', ticket, opts(new Date('2026-07-18T10:00:00Z')));
  const decision = decide(cache, 'fp1', opts(new Date('2026-07-18T10:05:00Z')));
  assert.equal(decision.action, 'comment');
});

test('decide: within cooldown, recent comment -> skip', () => {
  let cache: DedupCache = { entries: {} };
  cache = recordCreate(cache, 'fp1', ticket, opts(new Date('2026-07-18T10:00:00Z')));
  cache = recordSeenAgain(cache, 'fp1', opts(new Date('2026-07-18T10:05:00Z')), true);
  const decision = decide(cache, 'fp1', opts(new Date('2026-07-18T10:10:00Z')));
  assert.equal(decision.action, 'skip');
});

test('decide: after cooldown expires -> create again', () => {
  let cache: DedupCache = { entries: {} };
  cache = recordCreate(cache, 'fp1', ticket, opts(new Date('2026-07-18T10:00:00Z')));
  const decision = decide(cache, 'fp1', opts(new Date('2026-07-19T11:00:00Z')));
  assert.equal(decision.action, 'create');
});

test('recordSeenAgain increments count and optionally sets lastCommentAt', () => {
  let cache: DedupCache = { entries: {} };
  cache = recordCreate(cache, 'fp1', ticket, opts(new Date('2026-07-18T10:00:00Z')));
  cache = recordSeenAgain(cache, 'fp1', opts(new Date('2026-07-18T10:05:00Z')), true);
  assert.equal(cache.entries.fp1.count, 2);
  assert.equal(cache.entries.fp1.lastCommentAt, '2026-07-18T10:05:00.000Z');

  cache = recordSeenAgain(cache, 'fp1', opts(new Date('2026-07-18T10:06:00Z')), false);
  assert.equal(cache.entries.fp1.count, 3);
  assert.equal(cache.entries.fp1.lastCommentAt, '2026-07-18T10:05:00.000Z');
});
