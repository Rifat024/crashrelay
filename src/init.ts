import { randomBytes } from 'node:crypto';

export interface Prompter {
  checkbox(config: { message: string; choices: Array<{ name: string; value: string }> }): Promise<string[]>;
  input(config: { message: string; default?: string }): Promise<string>;
  password(config: { message: string }): Promise<string>;
  confirm(config: { message: string; default?: boolean }): Promise<boolean>;
}

export interface InitOptions {
  generateToken?: () => string;
}

/**
 * Prompts for provider credentials and prints an env-var export block —
 * this never touches the filesystem. The user is responsible for loading
 * the output into their own process manager / systemd unit / Docker
 * secrets, which is the only place this tool trusts credentials to live.
 */
export async function runInitWizard(prompter: Prompter, options: InitOptions = {}): Promise<string> {
  const generateToken = options.generateToken ?? (() => randomBytes(24).toString('hex'));

  const providers = await prompter.checkbox({
    message: 'Which ticket provider(s)?',
    choices: [
      { name: 'Jira', value: 'jira' },
      { name: 'GitHub Issues', value: 'github' },
    ],
  });
  if (providers.length === 0) {
    throw new Error('At least one provider must be selected.');
  }

  const lines: string[] = [
    '# --- crashrelay environment variables ---',
    '# Add these to your process manager / systemd unit / Docker secrets.',
    '# Do NOT commit this output to source control.',
  ];

  if (providers.includes('jira')) {
    const baseUrl = await prompter.input({ message: 'Jira base URL (e.g. https://yourco.atlassian.net)' });
    const email = await prompter.input({ message: 'Jira account email' });
    const apiToken = await prompter.password({ message: 'Jira API token' });
    const projectKey = await prompter.input({ message: 'Jira project key (e.g. OPS)' });
    const issueType = await prompter.input({ message: 'Jira issue type', default: 'Bug' });
    lines.push(
      `export JIRA_BASE_URL="${baseUrl}"`,
      `export JIRA_EMAIL="${email}"`,
      `export JIRA_API_TOKEN="${apiToken}"`,
      `export JIRA_PROJECT_KEY="${projectKey}"`,
      `export JIRA_ISSUE_TYPE="${issueType}"`,
    );
  }

  if (providers.includes('github')) {
    const token = await prompter.password({ message: 'GitHub personal access token' });
    const owner = await prompter.input({ message: 'GitHub repo owner' });
    const repo = await prompter.input({ message: 'GitHub repo name' });
    lines.push(`export GITHUB_TOKEN="${token}"`, `export GITHUB_OWNER="${owner}"`, `export GITHUB_REPO="${repo}"`);
  }

  const enableIngestion = await prompter.confirm({ message: 'Enable the frontend ingestion endpoint (/report)?', default: true });
  if (enableIngestion) {
    const port = await prompter.input({ message: 'Ingestion port', default: '4318' });
    const allowedOrigins = await prompter.input({ message: 'Allowed CORS origin(s), comma-separated' });
    const token = generateToken();
    lines.push(
      `export INGESTION_TOKEN="${token}"`,
      `export INGESTION_PORT="${port}"`,
      `export INGESTION_ALLOWED_ORIGINS="${allowedOrigins}"`,
    );
  }

  const dedupCooldownHours = await prompter.input({ message: 'Dedup cooldown hours (skip re-filing the same defect within this window)', default: '24' });
  lines.push(`export DEDUP_COOLDOWN_HOURS="${dedupCooldownHours}"`);

  const logPath = await prompter.input({ message: 'Log file path to tail (leave blank to skip)', default: '' });
  if (logPath) {
    const logPattern = await prompter.input({ message: 'Log line match pattern', default: 'ERROR' });
    lines.push(`export LOG_TAIL_PATH="${logPath}"`, `export LOG_TAIL_PATTERN="${logPattern}"`);
  }

  lines.push('', '# Next: load these into your environment, then run `crashrelay test-ticket` to verify connectivity.');

  return lines.join('\n') + '\n';
}
