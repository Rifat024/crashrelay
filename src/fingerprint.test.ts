import assert from 'node:assert';
import { test } from 'node:test';
import { normalizeMessage, normalizeStack, fingerprint, fingerprintLogLine } from './fingerprint';
import type { Defect } from './types';

test('normalizeMessage collapses UUIDs, numbers, and timestamps', () => {
  const a = normalizeMessage('user 4821 not found at 2026-07-18T10:00:00.000Z');
  const b = normalizeMessage('user 9012 not found at 2026-07-18T11:30:00.000Z');
  assert.equal(a, b);
});

test('normalizeMessage collapses UUIDs specifically', () => {
  const a = normalizeMessage('missing record 123e4567-e89b-12d3-a456-426614174000');
  const b = normalizeMessage('missing record 999e4567-e89b-12d3-a456-426614174999');
  assert.equal(a, b);
});

test('normalizeStack strips line/column and keeps function+file', () => {
  const stack = [
    'Error: boom',
    '    at doThing (/app/src/handler.js:42:17)',
    '    at process._tickCallback (internal/process/task_queues.js:75:11)',
  ].join('\n');
  const normalized = normalizeStack(stack);
  assert.ok(normalized.includes('doThing@src/handler.js'));
  assert.ok(!normalized.includes(':42:17'));
});

test('normalizeStack drops Node-internal frames so incidental async timing does not fragment the fingerprint', () => {
  // Same logical crash, but the trailing internal frame differs depending on
  // whether the Error was thrown synchronously vs. after a real macrotask
  // boundary (setTimeout) — this must not change the normalized result.
  const withMicrotaskTail = 'Error: boom\n    at main (/app/index.js:64:41)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)';
  const withoutTail = 'Error: boom\n    at main (/app/index.js:69:41)';
  assert.equal(normalizeStack(withMicrotaskTail), normalizeStack(withoutTail));
});

test('fingerprint is stable across cosmetic differences and differs for different errors', () => {
  const base: Defect = {
    type: 'process-crash',
    message: 'user 4821 not found',
    stack: 'Error: boom\n    at doThing (/app/src/handler.js:42:17)',
    occurredAt: '2026-07-18T10:00:00.000Z',
  };
  const variant: Defect = { ...base, message: 'user 9012 not found', occurredAt: '2026-07-18T12:00:00.000Z' };
  const different: Defect = { ...base, message: 'totally different error' };

  assert.equal(fingerprint(base), fingerprint(variant));
  assert.notEqual(fingerprint(base), fingerprint(different));
});

test('fingerprintLogLine incorporates the matcher id', () => {
  const a = fingerprintLogLine('ERROR', 'db connection lost');
  const b = fingerprintLogLine('WARN', 'db connection lost');
  assert.notEqual(a, b);
});
