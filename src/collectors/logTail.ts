import { promises as fs } from 'node:fs';
import type { Defect } from '../types';
import type { DefectHandler } from './processCrash';

export interface FileState {
  offset: number;
  inode: number;
}

export interface PollResult {
  lines: string[];
  state: FileState;
}

/**
 * Reads only the bytes appended since `state.offset`. Detects rotation
 * (inode changed — the old file was replaced) and truncation (size shrank
 * below the last offset) and resets to the start of the new/truncated file
 * in either case — naive tailing breaks silently after logrotate/Docker log
 * truncation otherwise, and a crash-looping service is exactly the kind
 * whose logs rotate often.
 */
export async function readNewLines(path: string, state: FileState): Promise<PollResult> {
  const stat = await fs.stat(path);
  let offset = state.offset;
  if (stat.ino !== state.inode || stat.size < offset) {
    offset = 0;
  }
  if (stat.size <= offset) {
    return { lines: [], state: { offset, inode: stat.ino } };
  }

  const handle = await fs.open(path, 'r');
  try {
    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    const text = buffer.toString('utf8');
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) {
      // No complete line yet — don't advance the offset past a partial line.
      return { lines: [], state: { offset, inode: stat.ino } };
    }
    const complete = text.slice(0, lastNewline);
    const lines = complete.split('\n').filter((line) => line.length > 0);
    const newOffset = offset + Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8');
    return { lines, state: { offset: newOffset, inode: stat.ino } };
  } finally {
    await handle.close();
  }
}

export function buildMatcher(pattern: string | RegExp): (line: string) => boolean {
  if (typeof pattern === 'string') {
    return (line) => line.includes(pattern);
  }
  return (line) => pattern.test(line);
}

export interface TailLogOptions {
  pollIntervalMs?: number;
  now?: () => Date;
  /** Injected in tests to bypass the real filesystem entirely. */
  poll?: (state: FileState) => Promise<PollResult>;
}

/** Starts polling `path` for new lines matching `pattern`, reporting each match as a `log-error` defect. Returns a dispose function. */
export function tailLog(path: string, pattern: string | RegExp, handler: DefectHandler, options: TailLogOptions = {}): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const now = options.now ?? (() => new Date());
  const matches = buildMatcher(pattern);
  const matcherId = typeof pattern === 'string' ? pattern : pattern.source;
  const poll = options.poll ?? ((state: FileState) => readNewLines(path, state));

  let state: FileState = { offset: 0, inode: -1 };
  let disposed = false;

  const tick = async () => {
    if (disposed) return;
    try {
      const result = await poll(state);
      state = result.state;
      for (const line of result.lines) {
        if (matches(line)) {
          const defect: Defect = {
            type: 'log-error',
            message: line,
            context: { matcher: matcherId, path },
            occurredAt: now().toISOString(),
          };
          await handler(defect);
        }
      }
    } catch {
      // File may not exist yet (app hasn't started logging) — retry next tick rather than crashing the daemon.
    }
  };

  const timer = setInterval(() => void tick(), pollIntervalMs);
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
