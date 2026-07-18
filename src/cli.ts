#!/usr/bin/env node
import { Command } from 'commander';
import { checkbox, confirm, input, password } from '@inquirer/prompts';
import { runInitWizard, type Prompter } from './init';
import { loadConfig } from './config';
import { resolveProviders } from './providers';
import { realFetcher } from './fetcher';
import { createPipeline } from './pipeline';
import { startDaemon } from './daemon';
import { readCache } from './dedup';

const program = new Command();

program
  .name('crashrelay')
  .description('Catch backend crashes, HTTP 5xx responses, log errors, and frontend JS errors, and auto-file tickets in Jira or GitHub Issues.')
  .version('0.1.0');

const realPrompter: Prompter = { checkbox, input, password, confirm };

program
  .command('init')
  .description('Interactive setup wizard — prints an environment-variable block, never writes a file.')
  .action(async () => {
    const output = await runInitWizard(realPrompter);
    console.log('\n' + output);
  });

program
  .command('start')
  .description('Run the standalone daemon: log-file tailing + the frontend-error ingestion endpoint.')
  .action(() => {
    const config = loadConfig();
    const providers = resolveProviders(config, realFetcher);
    const pipeline = createPipeline(config, providers);
    startDaemon(config, pipeline.handleDefect);
    console.log('[crashrelay] daemon running. Remember: crash/HTTP-5xx capture must be required inside your own app — see the README.');
  });

program
  .command('test-ticket')
  .description('Verify ticket-provider connectivity. Dry-run by default; --live creates one real test ticket.')
  .option('--live', 'create a real test ticket instead of just checking the connection', false)
  .action(async (opts) => {
    const config = loadConfig();
    const providers = resolveProviders(config, realFetcher);
    const provider = providers[0];
    if (!provider) {
      console.error('No ticket provider configured.');
      process.exitCode = 1;
      return;
    }

    if (!opts.live) {
      await provider.checkConnection();
      console.log(`✓ ${provider.name} connection OK.`);
      return;
    }

    const ticket = await provider.createTicket({
      type: 'process-crash',
      message: 'crashrelay test-ticket — safe to close',
      occurredAt: new Date().toISOString(),
    });
    console.log(`✓ Created test ticket: ${ticket.url}`);
  });

program
  .command('status')
  .description('Show the dedup cache: recently seen defects and their tickets.')
  .action(async () => {
    const config = loadConfig();
    const cache = await readCache(config.cacheFilePath);
    const entries = Object.entries(cache.entries);
    if (entries.length === 0) {
      console.log('No defects recorded yet.');
      return;
    }
    for (const [fp, entry] of entries) {
      console.log(`${fp.slice(0, 12)}  count=${entry.count}  ${entry.ticket.provider}:${entry.ticket.id}  ${entry.ticket.url}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
