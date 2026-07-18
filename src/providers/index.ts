import type { Fetcher } from '../fetcher';
import type { Config } from '../types';
import type { TicketProvider } from './types';
import { createJiraProvider } from './jira';
import { createGithubProvider } from './github';

export function resolveProviders(config: Config, fetcher: Fetcher): TicketProvider[] {
  const providers: TicketProvider[] = [];
  if (config.jira) providers.push(createJiraProvider(config.jira, fetcher));
  if (config.github) providers.push(createGithubProvider(config.github, fetcher));
  return providers;
}

export type { TicketProvider } from './types';
export { textToAdf } from './adf';
export { buildSummary, buildBody } from './format';
