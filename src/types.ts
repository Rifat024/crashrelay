export type DefectType = 'process-crash' | 'unhandled-rejection' | 'http-5xx' | 'log-error' | 'client-error';

export interface Defect {
  type: DefectType;
  message: string;
  stack?: string;
  /** Extra context: route, status code, log line, source URL, etc. */
  context?: Record<string, string | number | undefined>;
  occurredAt: string;
}

export interface TicketRef {
  provider: string;
  id: string;
  url: string;
}

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
}

export interface GithubConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface IngestionConfig {
  enabled: boolean;
  port: number;
  token: string;
  allowedOrigins: string[];
}

export interface Config {
  jira?: JiraConfig;
  github?: GithubConfig;
  ingestion?: IngestionConfig;
  dedupCooldownHours: number;
  commentCooldownMinutes: number;
  logTailPath?: string;
  logTailPattern: string;
  cacheFilePath: string;
}

export interface DedupCacheEntry {
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  cooldownUntil: string;
  lastCommentAt?: string;
  ticket: TicketRef;
}

export interface DedupCache {
  entries: Record<string, DedupCacheEntry>;
}

export type DedupDecision =
  | { action: 'create' }
  | { action: 'comment'; entry: DedupCacheEntry }
  | { action: 'skip'; entry: DedupCacheEntry };
