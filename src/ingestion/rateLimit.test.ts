import assert from 'node:assert';
import { test } from 'node:test';
import { createRateLimiter } from './rateLimit';

test('allows up to max requests within the window, then blocks', () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: () => now });

  assert.equal(limiter.allow('ip1'), true);
  assert.equal(limiter.allow('ip1'), true);
  assert.equal(limiter.allow('ip1'), true);
  assert.equal(limiter.allow('ip1'), false);
});

test('window slides — old hits expire and free up capacity', () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });

  assert.equal(limiter.allow('ip1'), true);
  assert.equal(limiter.allow('ip1'), true);
  assert.equal(limiter.allow('ip1'), false);

  now = 1500; // past the window
  assert.equal(limiter.allow('ip1'), true);
});

test('different keys are tracked independently', () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => now });
  assert.equal(limiter.allow('ip1'), true);
  assert.equal(limiter.allow('ip2'), true);
});
