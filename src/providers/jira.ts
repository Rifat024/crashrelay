import type { Fetcher } from '../fetcher';
import type { Defect, JiraConfig, TicketRef } from '../types';
import type { TicketProvider } from './types';
import { textToAdf } from './adf';
import { buildBody, buildSummary } from './format';

interface JiraCreateResponse {
  id: string;
  key: string;
  self: string;
}

function authHeader(config: JiraConfig): string {
  const encoded = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return `Basic ${encoded}`;
}

async function jiraFetch(config: JiraConfig, fetcher: Fetcher, path: string, init?: { method?: string; body?: unknown }) {
  const response = await fetcher(`${config.baseUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Jira API error (HTTP ${response.status}) for ${path}`);
  }
  return response;
}

export function createJiraProvider(config: JiraConfig, fetcher: Fetcher): TicketProvider {
  return {
    name: 'jira',

    async createTicket(defect: Defect): Promise<TicketRef> {
      const response = await jiraFetch(config, fetcher, '/rest/api/3/issue', {
        method: 'POST',
        body: {
          fields: {
            project: { key: config.projectKey },
            summary: buildSummary(defect),
            issuetype: { name: config.issueType },
            description: textToAdf(buildBody(defect)),
          },
        },
      });
      const body = (await response.json()) as JiraCreateResponse;
      return { provider: 'jira', id: body.key, url: `${config.baseUrl}/browse/${body.key}` };
    },

    async addComment(ticket: TicketRef, text: string): Promise<void> {
      await jiraFetch(config, fetcher, `/rest/api/3/issue/${ticket.id}/comment`, {
        method: 'POST',
        body: { body: textToAdf(text) },
      });
    },

    async checkConnection(): Promise<void> {
      await jiraFetch(config, fetcher, `/rest/api/3/project/${config.projectKey}`);
    },
  };
}
