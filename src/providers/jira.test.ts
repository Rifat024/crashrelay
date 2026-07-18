import assert from 'node:assert';
import { test } from 'node:test';
import { createJiraProvider } from './jira';
import type { Fetcher } from '../fetcher';
import type { Defect, JiraConfig } from '../types';

const config: JiraConfig = {
  baseUrl: 'https://x.atlassian.net',
  email: 'me@x.com',
  apiToken: 'secret-token',
  projectKey: 'OPS',
  issueType: 'Bug',
};

const defect: Defect = {
  type: 'process-crash',
  message: 'TypeError: boom',
  stack: 'Error: boom\n    at f (/app/x.js:1:1)',
  occurredAt: '2026-07-18T10:00:00.000Z',
};

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

test('createTicket posts to /rest/api/3/issue with Basic auth and ADF description', async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 201, body: { id: '10001', key: 'OPS-142', self: 'https://x.atlassian.net/rest/api/3/issue/10001' } }]);
  const provider = createJiraProvider(config, fetcher);

  const ticket = await provider.createTicket(defect);

  assert.equal(ticket.provider, 'jira');
  assert.equal(ticket.id, 'OPS-142');
  assert.equal(ticket.url, 'https://x.atlassian.net/browse/OPS-142');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.atlassian.net/rest/api/3/issue');
  const init = calls[0].init as { method: string; headers: Record<string, string>; body: string };
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from('me@x.com:secret-token').toString('base64')}`);
  const body = JSON.parse(init.body);
  assert.equal(body.fields.project.key, 'OPS');
  assert.equal(body.fields.issuetype.name, 'Bug');
  assert.equal(body.fields.description.type, 'doc');
});

test('createTicket throws a readable error on a non-2xx response', async () => {
  const { fetcher } = fakeFetcher([{ status: 401, body: {} }]);
  const provider = createJiraProvider(config, fetcher);
  await assert.rejects(() => provider.createTicket(defect), /HTTP 401/);
});

test('addComment posts to the issue comment endpoint', async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 201, body: {} }]);
  const provider = createJiraProvider(config, fetcher);
  await provider.addComment({ provider: 'jira', id: 'OPS-142', url: '...' }, 'seen again');
  assert.equal(calls[0].url, 'https://x.atlassian.net/rest/api/3/issue/OPS-142/comment');
});

test('checkConnection reads the project without creating anything', async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 200, body: { key: 'OPS' } }]);
  const provider = createJiraProvider(config, fetcher);
  await provider.checkConnection();
  assert.equal(calls[0].url, 'https://x.atlassian.net/rest/api/3/project/OPS');
  const init = calls[0].init as { method: string };
  assert.equal(init.method, 'GET');
});
