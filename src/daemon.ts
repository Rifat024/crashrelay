import type { Config } from './types';
import type { DefectHandler } from './collectors/processCrash';
import { tailLog } from './collectors/logTail';
import { createIngestionServer } from './ingestion/server';

export interface DaemonHandle {
  stop(): Promise<void>;
}

/**
 * Runs the two pieces of crashrelay that genuinely can live in a separate
 * always-on process: log-file tailing and the frontend-error ingestion
 * endpoint. Crash/HTTP-5xx capture is a library embedded in the monitored
 * app itself (see index.ts) — a separate process cannot hook another
 * process's exceptions, that's a Node/OS limitation.
 */
export function startDaemon(config: Config, handler: DefectHandler): DaemonHandle {
  const disposers: Array<() => void | Promise<void>> = [];

  if (config.logTailPath) {
    console.log(`[crashrelay] tailing ${config.logTailPath} for pattern "${config.logTailPattern}"`);
    disposers.push(tailLog(config.logTailPath, config.logTailPattern, handler));
  } else {
    console.log('[crashrelay] no LOG_TAIL_PATH configured — skipping log tailing');
  }

  if (config.ingestion?.enabled) {
    const server = createIngestionServer(config.ingestion, handler);
    server.listen(config.ingestion.port);
    console.log(`[crashrelay] ingestion endpoint listening on port ${config.ingestion.port}`);
    disposers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  } else {
    console.log('[crashrelay] no INGESTION_TOKEN configured — frontend ingestion endpoint disabled');
  }

  return {
    async stop() {
      for (const dispose of disposers) await dispose();
    },
  };
}
