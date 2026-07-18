import assert from 'node:assert';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createIngestionServer } from './server';
import { createRateLimiter } from './rateLimit';
import type { Defect, IngestionConfig } from '../types';

const config: IngestionConfig = {
  enabled: true,
  port: 0,
  token: 'test-token',
  allowedOrigins: ['https://app.example.com'],
};

async function withServer(fn: (baseUrl: string, received: Defect[]) => Promise<void>, opts: Parameters<typeof createIngestionServer>[2] = {}) {
  const received: Defect[] = [];
  const server = createIngestionServer(config, async (d) => void received.push(d), opts);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`, received);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /health returns 200', () =>
  withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
  }));

test('OPTIONS preflight returns 204 with CORS headers', () =>
  withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/report`, { method: 'OPTIONS', headers: { Origin: 'https://app.example.com' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example.com');
    assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  }));

test('POST without a valid bearer token returns 401', () =>
  withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/report`, { method: 'POST', body: JSON.stringify({ message: 'x' }) });
    assert.equal(res.status, 401);
  }));

test('valid POST returns 202 and invokes the handler', () =>
  withServer(async (baseUrl, received) => {
    const res = await fetch(`${baseUrl}/report`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'window blew up', stack: 'at x', url: 'https://app.example.com/page' }),
    });
    assert.equal(res.status, 202);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'client-error');
    assert.equal(received[0].message, 'window blew up');
  }));

test('oversized body returns 413', () =>
  withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/report`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: 'x'.repeat(20 * 1024),
    });
    assert.equal(res.status, 413);
  }));

test('rate limit blocks requests past the configured max', () =>
  withServer(
    async (baseUrl) => {
      const attempt = () => fetch(`${baseUrl}/report`, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify({ message: 'x' }) });
      await attempt();
      const second = await attempt();
      assert.equal(second.status, 429);
    },
    { rateLimiter: createRateLimiter({ windowMs: 60_000, max: 1 }) },
  ));
