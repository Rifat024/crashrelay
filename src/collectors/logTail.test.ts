import assert from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMatcher, readNewLines, tailLog, type FileState, type PollResult } from './logTail';
import type { Defect } from '../types';

test('buildMatcher supports string substring and RegExp patterns', () => {
  assert.equal(buildMatcher('ERROR')('2026 ERROR db down'), true);
  assert.equal(buildMatcher('ERROR')('2026 INFO ok'), false);
  assert.equal(buildMatcher(/ERR\d+/)('ERR42 something'), true);
});

test('tailLog (injected poll) reports only matching lines and updates state across ticks', async () => {
  const received: Defect[] = [];
  let call = 0;
  const results: PollResult[] = [
    { lines: ['INFO ok', 'ERROR db down'], state: { offset: 100, inode: 1 } },
    { lines: ['ERROR disk full'], state: { offset: 200, inode: 1 } },
  ];

  const dispose = tailLog('unused.log', 'ERROR', async (d) => void received.push(d), {
    pollIntervalMs: 5,
    poll: async (_state: FileState) => results[Math.min(call++, results.length - 1)],
  });

  await new Promise((r) => setTimeout(r, 40));
  dispose();

  assert.ok(received.length >= 2);
  assert.ok(received.every((d) => d.type === 'log-error'));
  assert.ok(received.some((d) => d.message === 'ERROR db down'));
  assert.ok(received.some((d) => d.message === 'ERROR disk full'));
});

test('readNewLines only returns bytes appended since the last offset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cr-logtail-'));
  try {
    const path = join(dir, 'app.log');
    await writeFile(path, 'line one\nline two\n', 'utf8');

    const first = await readNewLines(path, { offset: 0, inode: -1 });
    assert.deepEqual(first.lines, ['line one', 'line two']);

    await appendFile(path, 'line three\n', 'utf8');
    const second = await readNewLines(path, first.state);
    assert.deepEqual(second.lines, ['line three']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readNewLines withholds a partial (unterminated) last line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cr-logtail-'));
  try {
    const path = join(dir, 'app.log');
    await writeFile(path, 'complete line\npartial line without newline', 'utf8');
    const result = await readNewLines(path, { offset: 0, inode: -1 });
    assert.deepEqual(result.lines, ['complete line']);

    await appendFile(path, ' finished\n', 'utf8');
    const second = await readNewLines(path, result.state);
    assert.deepEqual(second.lines, ['partial line without newline finished']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readNewLines resets to the start when the file is truncated (rotation-safe)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cr-logtail-'));
  try {
    const path = join(dir, 'app.log');
    await writeFile(path, 'a very long first line that will be truncated away\n', 'utf8');
    const first = await readNewLines(path, { offset: 0, inode: -1 });
    assert.equal(first.lines.length, 1);

    await writeFile(path, 'short\n', 'utf8'); // truncate + rewrite, simulating rotation
    const second = await readNewLines(path, first.state);
    assert.deepEqual(second.lines, ['short']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
