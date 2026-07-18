import type { Config } from './types';

export class ConfigError extends Error {}

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`${key} must be a number, got "${raw}"`);
  return value;
}

/**
 * Reads configuration from environment variables only — this tool never
 * writes credentials to a file it manages itself. At least one of
 * JIRA_* / GITHUB_* must be fully configured, or nothing can ever create a
 * ticket.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jiraFields = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'];
  const hasJira = jiraFields.some((key) => env[key]);
  if (hasJira && !jiraFields.every((key) => env[key])) {
    throw new ConfigError(`Partial Jira config detected — set all of ${jiraFields.join(', ')} or none of them.`);
  }

  const githubFields = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
  const hasGithub = githubFields.some((key) => env[key]);
  if (hasGithub && !githubFields.every((key) => env[key])) {
    throw new ConfigError(`Partial GitHub config detected — set all of ${githubFields.join(', ')} or none of them.`);
  }

  if (!hasJira && !hasGithub) {
    throw new ConfigError('No ticket provider configured. Run `crashrelay init` first, or set JIRA_* / GITHUB_* environment variables.');
  }

  const ingestionEnabled = env.INGESTION_TOKEN !== undefined;

  return {
    jira: hasJira
      ? {
          baseUrl: env.JIRA_BASE_URL!,
          email: env.JIRA_EMAIL!,
          apiToken: env.JIRA_API_TOKEN!,
          projectKey: env.JIRA_PROJECT_KEY!,
          issueType: env.JIRA_ISSUE_TYPE || 'Bug',
        }
      : undefined,
    github: hasGithub
      ? {
          token: env.GITHUB_TOKEN!,
          owner: env.GITHUB_OWNER!,
          repo: env.GITHUB_REPO!,
        }
      : undefined,
    ingestion: ingestionEnabled
      ? {
          enabled: true,
          port: envInt(env, 'INGESTION_PORT', 4318),
          token: env.INGESTION_TOKEN!,
          allowedOrigins: (env.INGESTION_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        }
      : undefined,
    dedupCooldownHours: envInt(env, 'DEDUP_COOLDOWN_HOURS', 24),
    commentCooldownMinutes: envInt(env, 'COMMENT_COOLDOWN_MINUTES', 60),
    logTailPath: env.LOG_TAIL_PATH || undefined,
    logTailPattern: env.LOG_TAIL_PATTERN || 'ERROR',
    cacheFilePath: env.CRASHRELAY_CACHE_PATH || '.crashrelay-dedup-cache.json',
  };
}
