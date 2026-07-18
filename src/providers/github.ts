import type { Fetcher } from '../fetcher';
import type { Defect, GithubConfig, TicketRef } from '../types';
import type { TicketProvider } from './types';
import { buildBody, buildSummary } from './format';

interface GithubIssueResponse {
  id: number;
  number: number;
  html_url: string;
}

async function githubFetch(config: GithubConfig, fetcher: Fetcher, path: string, init?: { method?: string; body?: unknown }) {
  const response = await fetcher(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`GitHub API error (HTTP ${response.status}) for ${path}`);
  }
  return response;
}

export function createGithubProvider(config: GithubConfig, fetcher: Fetcher): TicketProvider {
  return {
    name: 'github',

    async createTicket(defect: Defect): Promise<TicketRef> {
      const response = await githubFetch(config, fetcher, '/issues', {
        method: 'POST',
        body: {
          title: buildSummary(defect),
          body: '```\n' + buildBody(defect) + '\n```',
          labels: ['crashrelay', 'auto-filed'],
        },
      });
      const body = (await response.json()) as GithubIssueResponse;
      return { provider: 'github', id: `#${body.number}`, url: body.html_url };
    },

    async addComment(ticket: TicketRef, text: string): Promise<void> {
      const number = ticket.id.replace(/^#/, '');
      await githubFetch(config, fetcher, `/issues/${number}/comments`, {
        method: 'POST',
        body: { body: text },
      });
    },

    async checkConnection(): Promise<void> {
      await githubFetch(config, fetcher, '');
    },
  };
}
