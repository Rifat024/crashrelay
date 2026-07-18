import assert from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPipeline } from './pipeline';
import type { TicketProvider } from './providers/types';
import type { Config, Defect, TicketRef } from './types';

function fakeProvider(): TicketProvider & { createCalls: Defect[]; commentCalls: Array<{ ticket: TicketRef; text: string }> } {
  const createCalls: Defect[] = [];
  const commentCalls: Array<{ ticket: TicketRef; text: string }> = [];
  return {
    name: 'fake',
    createCalls,
    commentCalls,
    async createTicket(defect: Defect): Promise<TicketRef> {
      createCalls.push(defect);
      return { provider: 'fake', id: `T${createCalls.length}`, url: `https://example.com/T${createCalls.length}` };
    },
    async addComment(ticket: TicketRef, text: string): Promise<void> {
      commentCalls.push({ ticket, text });
    },
    async checkConnection(): Promise<void> {},
  };
}

async function withConfig(fn: (config: Config) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'cr-pipeline-'));
  try {
    await fn({
      dedupCooldownHours: 24,
      commentCooldownMinutes: 60,
      logTailPattern: 'ERROR',
      cacheFilePath: join(dir, 'cache.json'),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const defect: Defect = { type: 'process-crash', message: 'boom', occurredAt: '2026-07-18T10:00:00.000Z' };

test('first-time defect creates a ticket', () =>
  withConfig(async (config) => {
    const provider = fakeProvider();
    const pipeline = createPipeline(config, [provider]);
    await pipeline.handleDefect(defect);
    assert.equal(provider.createCalls.length, 1);
  }));

test('the same defect again within cooldown adds a comment instead of a new ticket', () =>
  withConfig(async (config) => {
    const provider = fakeProvider();
    const pipeline = createPipeline(config, [provider]);
    await pipeline.handleDefect(defect);
    await pipeline.handleDefect(defect);
    assert.equal(provider.createCalls.length, 1);
    assert.equal(provider.commentCalls.length, 1);
  }));

test('rapid repeats only comment once within the comment cooldown', () =>
  withConfig(async (config) => {
    const provider = fakeProvider();
    const pipeline = createPipeline(config, [provider]);
    await pipeline.handleDefect(defect);
    await pipeline.handleDefect(defect);
    await pipeline.handleDefect(defect);
    assert.equal(provider.createCalls.length, 1);
    assert.equal(provider.commentCalls.length, 1);
  }));

test('a different defect gets its own ticket', () =>
  withConfig(async (config) => {
    const provider = fakeProvider();
    const pipeline = createPipeline(config, [provider]);
    await pipeline.handleDefect(defect);
    await pipeline.handleDefect({ ...defect, message: 'a totally different failure' });
    assert.equal(provider.createCalls.length, 2);
  }));

test('concurrent defects (fired without awaiting each other) all get their own ticket and none is lost from the cache', () =>
  withConfig(async (config) => {
    const provider = fakeProvider();
    const pipeline = createPipeline(config, [provider]);
    const defects: Defect[] = Array.from({ length: 5 }, (_, i) => ({ ...defect, message: `spam ${i}` }));

    // Deliberately not awaited individually — this is what a burst of
    // concurrent ingestion-endpoint requests looks like.
    await Promise.all(defects.map((d) => pipeline.handleDefect(d)));

    assert.equal(provider.createCalls.length, 5);
  }));

test('concurrent duplicate defects (same fingerprint, fired concurrently) create exactly one ticket', () =>
  withConfig(async (config) => {
    const provider = fakeProvider();
    const pipeline = createPipeline(config, [provider]);

    await Promise.all([pipeline.handleDefect(defect), pipeline.handleDefect(defect), pipeline.handleDefect(defect)]);

    assert.equal(provider.createCalls.length, 1);
  }));

test('throws a readable error when no provider is configured', () =>
  withConfig(async (config) => {
    const pipeline = createPipeline(config, []);
    await assert.rejects(() => pipeline.handleDefect(defect), /No ticket provider configured/);
  }));
