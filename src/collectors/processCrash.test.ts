import assert from 'node:assert';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { installCrashHandlers, type CrashTarget } from './processCrash';
import type { Defect } from '../types';

type FakeTarget = CrashTarget & EventEmitter & { exitCalls: number[] };

function fakeTarget(): FakeTarget {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    exitCalls: [] as number[],
    exit(code: number) {
      (this as unknown as { exitCalls: number[] }).exitCalls.push(code);
    },
  }) as FakeTarget;
}

test('uncaughtException is reported and, by default, exits after a grace period', async () => {
  const target = fakeTarget();
  const received: Defect[] = [];
  installCrashHandlers(async (d) => void received.push(d), { target, exitGraceMs: 10 });

  target.emit('uncaughtException', new Error('kaboom'));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'process-crash');
  assert.equal(received[0].message, 'kaboom');
  assert.ok(target.exitCalls.includes(1));
});

test('uncaughtException does not exit when exitOnUncaughtException is false', async () => {
  const target = fakeTarget();
  installCrashHandlers(async () => {}, { target, exitOnUncaughtException: false, exitGraceMs: 10 });

  target.emit('uncaughtException', new Error('kaboom'));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(target.exitCalls.length, 0);
});

test('unhandledRejection is report-only and never exits', async () => {
  const target = fakeTarget();
  const received: Defect[] = [];
  installCrashHandlers(async (d) => void received.push(d), { target });

  target.emit('unhandledRejection', new Error('rejected'));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'unhandled-rejection');
  assert.equal(target.exitCalls.length, 0);
});

test('unhandledRejection handles non-Error reasons', async () => {
  const target = fakeTarget();
  const received: Defect[] = [];
  installCrashHandlers(async (d) => void received.push(d), { target });

  target.emit('unhandledRejection', 'just a string reason');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(received[0].message, 'just a string reason');
});

test('dispose removes the listeners', async () => {
  const target = fakeTarget();
  const received: Defect[] = [];
  const dispose = installCrashHandlers(async (d) => void received.push(d), { target, exitOnUncaughtException: false });

  dispose();
  target.emit('uncaughtException', new Error('after dispose'));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(received.length, 0);
});
