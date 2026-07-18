import type { Defect } from '../types';

export interface CrashTarget {
  on(event: 'uncaughtException', listener: (err: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
}

export type DefectHandler = (defect: Defect) => Promise<void>;

export interface InstallCrashHandlersOptions {
  /** Defaults to the real `process` — inject a fake EventEmitter-like target in tests so the real process is never touched. */
  target?: CrashTarget;
  /** Node's own guidance: process state is undefined after an uncaughtException, so the default is report-then-exit, not swallow-and-continue. */
  exitOnUncaughtException?: boolean;
  /** How long to wait for the report to flush before exiting. */
  exitGraceMs?: number;
  now?: () => Date;
}

function reasonToDefect(type: Defect['type'], reason: unknown, now: () => Date): Defect {
  if (reason instanceof Error) {
    return { type, message: reason.message, stack: reason.stack, occurredAt: now().toISOString() };
  }
  return { type, message: typeof reason === 'string' ? reason : JSON.stringify(reason), occurredAt: now().toISOString() };
}

/**
 * Installs process-level crash handlers. `unhandledRejection` is
 * report-only (Node doesn't treat it as fatal by default, and many apps
 * intentionally don't either); `uncaughtException` is report-then-exit,
 * since process state is undefined afterward.
 */
export function installCrashHandlers(handler: DefectHandler, options: InstallCrashHandlersOptions = {}): () => void {
  const target = options.target ?? (process as unknown as CrashTarget);
  const exitOnUncaughtException = options.exitOnUncaughtException ?? true;
  const exitGraceMs = options.exitGraceMs ?? 1000;
  const now = options.now ?? (() => new Date());

  const onUncaughtException = (err: Error) => {
    const defect = reasonToDefect('process-crash', err, now);
    const reportPromise = handler(defect).catch(() => undefined);
    if (exitOnUncaughtException) {
      const timer = setTimeout(() => target.exit(1), exitGraceMs);
      reportPromise.finally(() => {
        clearTimeout(timer);
        target.exit(1);
      });
    }
  };

  const onUnhandledRejection = (reason: unknown) => {
    void handler(reasonToDefect('unhandled-rejection', reason, now));
  };

  target.on('uncaughtException', onUncaughtException);
  target.on('unhandledRejection', onUnhandledRejection);

  return () => {
    target.off('uncaughtException', onUncaughtException as (...args: unknown[]) => void);
    target.off('unhandledRejection', onUnhandledRejection as (...args: unknown[]) => void);
  };
}
