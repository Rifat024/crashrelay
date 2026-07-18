import assert from 'node:assert';
import { test } from 'node:test';
import { createGithubProvider } from './github';
import type { Fetcher } from '../fetcher';
import type { Defect, GithubConfig } from '../types';

const config: GithubConfig = { token: 'ghp_secret', owner: 'acme', repo: 'app' };

const defect: Defect = { type: 'http-5xx', message: 'Internal Server Error', occurredAt: '2026-07-18T10:00:00.000Z' };

function fakeFetcher(responses: Array<{ status: number; body: unknown }>): { fetcher: Fetcher; calls: Array<{ url: string; init?: unknown }> } {
  const calls: Array<{ url: string; init?: unknown }> = [];
  let i = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetcher, calls };
}

test('createTicket posts to /repos/{owner}/{repo}/issues with Bearer auth', async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 201, body: { id: 1, number: 42, html_url: 'https://github.com/acme/app/issues/42' } }]);
  const provider = createGithubProvider(config, fetcher);

  const ticket = await provider.createTicket(defect);

  assert.equal(ticket.provider, 'github');
  assert.equal(ticket.id, '#42');
  assert.equal(ticket.url, 'https://github.com/acme/app/issues/42');

  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/issues');
  const init = calls[0].init as { headers: Record<string, string>; body: string };
  assert.equal(init.headers.Authorization, 'Bearer ghp_secret');
  const body = JSON.parse(init.body);
  assert.ok(body.labels.includes('crashrelay'));
});

test('createTicket throws a readable error on a non-2xx response', async () => {
  const { fetcher } = fakeFetcher([{ status: 404, body: {} }]);
  const provider = createGithubProvider(config, fetcher);
  await assert.rejects(() => provider.createTicket(defect), /HTTP 404/);
});

test('addComment strips the # prefix when building the comment URL', async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 201, body: {} }]);
  const provider = createGithubProvider(config, fetcher);
  await provider.addComment({ provider: 'github', id: '#42', url: '...' }, 'seen again');
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/issues/42/comments');
});

test('checkConnection reads the repo without creating anything', async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 200, body: {} }]);
  const provider = createGithubProvider(config, fetcher);
  await provider.checkConnection();
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app');
});
