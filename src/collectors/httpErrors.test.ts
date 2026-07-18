import assert from 'node:assert';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { httpStatusMiddleware, expressErrorHandler, reportDefect } from './httpErrors';
import type { Defect } from '../types';

function fakeReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { method: 'GET', url: '/api/thing', ...overrides } as IncomingMessage;
}

function fakeRes(statusCode: number): ServerResponse {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { statusCode }) as unknown as ServerResponse;
}

test('httpStatusMiddleware reports only when statusCode >= 500', async () => {
  const received: Defect[] = [];
  const middleware = httpStatusMiddleware(async (d) => void received.push(d));

  const req500 = fakeReq();
  const res500 = fakeRes(500);
  let nextCalled = false;
  middleware(req500, res500, () => (nextCalled = true));
  assert.ok(nextCalled);
  res500.emit('finish');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'http-5xx');

  const req200 = fakeReq();
  const res200 = fakeRes(200);
  middleware(req200, res200, () => {});
  res200.emit('finish');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(received.length, 1);
});

test('expressErrorHandler reports the error and calls next(err) to preserve default behavior', async () => {
  const received: Defect[] = [];
  const handler = expressErrorHandler(async (d) => void received.push(d));
  const err = new Error('handler blew up');
  const req = fakeReq();
  const res = fakeRes(500);

  let forwarded: unknown;
  handler(err, req, res, (e) => (forwarded = e));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(received.length, 1);
  assert.equal(received[0].message, 'handler blew up');
  assert.equal(forwarded, err);
});

test('reportDefect is a direct-call escape hatch for frameworks without 4-arg middleware', async () => {
  const received: Defect[] = [];
  reportDefect(async (d) => void received.push(d), new Error('fastify error'), { route: '/x' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(received[0].message, 'fastify error');
  assert.equal(received[0].context?.route, '/x');
});
