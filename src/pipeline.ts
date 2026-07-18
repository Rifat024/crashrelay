import type { Config, Defect } from './types';
import type { TicketProvider } from './providers/types';
import type { DefectHandler } from './collectors/processCrash';
import { readCache, writeCache, decide, recordCreate, recordSeenAgain } from './dedup';
import { fingerprint } from './fingerprint';

export interface Pipeline {
  handleDefect: DefectHandler;
}

/**
 * Only the first configured provider actually creates/owns the ticket —
 * the dedup cache stores one ticket ref per fingerprint, so "create in
 * every configured provider" would need a different cache shape. If both
 * Jira and GitHub are configured, Jira takes priority (resolveProviders
 * order); this is a deliberate v1 simplification, not an oversight.
 */
export function createPipeline(config: Config, providers: TicketProvider[], now: () => Date = () => new Date()): Pipeline {
  const provider = providers[0];

  // Multiple defects can arrive concurrently (e.g. a burst of frontend error
  // beacons, or a crash-loop firing faster than one read-modify-write cycle
  // completes). Without serializing access, two concurrent handlers can both
  // read the cache before either writes, and the second write silently loses
  // the first's update — or, worse, race a write of the same file if it were
  // ever run across multiple processes. This queue only protects a single
  // process's concurrent calls, not multiple daemon replicas sharing one
  // cache file (see README limitations).
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn, fn);
    queue = result.catch(() => undefined);
    return result;
  }

  async function handleDefect(defect: Defect): Promise<void> {
    if (!provider) {
      throw new Error('No ticket provider configured — run `crashrelay init` first.');
    }

    return serialized(async () => {
      const fp = fingerprint(defect);
      const cache = await readCache(config.cacheFilePath);
      const options = { cooldownHours: config.dedupCooldownHours, commentCooldownMinutes: config.commentCooldownMinutes, now };
      const decision = decide(cache, fp, options);

      if (decision.action === 'create') {
        const ticket = await provider.createTicket(defect);
        await writeCache(config.cacheFilePath, recordCreate(cache, fp, ticket, options));
        return;
      }

      if (decision.action === 'comment') {
        await provider.addComment(decision.entry.ticket, `Seen again (now ${decision.entry.count + 1} times). Last seen: ${defect.occurredAt}`);
        await writeCache(config.cacheFilePath, recordSeenAgain(cache, fp, options, true));
        return;
      }

      // 'skip' — within both the ticket cooldown and the comment cooldown; just tally the occurrence.
      await writeCache(config.cacheFilePath, recordSeenAgain(cache, fp, options, false));
    });
  }

  return { handleDefect };
}
