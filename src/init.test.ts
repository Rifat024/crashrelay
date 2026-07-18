import assert from 'node:assert';
import { test } from 'node:test';
import { runInitWizard, type Prompter } from './init';

function cannedPrompter(answers: { checkbox?: string[][]; input?: string[]; password?: string[]; confirm?: boolean[] }): Prompter {
  let ci = 0;
  let ii = 0;
  let pi = 0;
  let coi = 0;
  return {
    async checkbox() {
      return answers.checkbox?.[ci++] ?? [];
    },
    async input() {
      return answers.input?.[ii++] ?? '';
    },
    async password() {
      return answers.password?.[pi++] ?? '';
    },
    async confirm() {
      return answers.confirm?.[coi++] ?? false;
    },
  };
}

test('throws when no provider is selected', async () => {
  const prompter = cannedPrompter({ checkbox: [[]] });
  await assert.rejects(() => runInitWizard(prompter), /at least one provider/i);
});

test('produces an env-export block for Jira only, never touching the filesystem', async () => {
  const prompter = cannedPrompter({
    checkbox: [['jira']],
    input: ['https://x.atlassian.net', 'me@x.com', 'OPS', 'Bug', '24', ''],
    password: ['jira-token'],
    confirm: [false],
  });
  const output = await runInitWizard(prompter);

  assert.match(output, /export JIRA_BASE_URL="https:\/\/x\.atlassian\.net"/);
  assert.match(output, /export JIRA_API_TOKEN="jira-token"/);
  assert.doesNotMatch(output, /GITHUB_TOKEN/);
  assert.doesNotMatch(output, /INGESTION_TOKEN/);
});

test('produces an env-export block for GitHub + ingestion enabled, with a generated token', async () => {
  const prompter = cannedPrompter({
    checkbox: [['github']],
    input: ['acme', 'app', '4318', 'https://app.example.com', '24', ''],
    password: ['ghp_secret'],
    confirm: [true],
  });
  const output = await runInitWizard(prompter, { generateToken: () => 'generated-token-123' });

  assert.match(output, /export GITHUB_TOKEN="ghp_secret"/);
  assert.match(output, /export GITHUB_OWNER="acme"/);
  assert.match(output, /export GITHUB_REPO="app"/);
  assert.match(output, /export INGESTION_TOKEN="generated-token-123"/);
  assert.match(output, /export INGESTION_PORT="4318"/);
});

test('never writes any file — output is a plain string', async () => {
  const prompter = cannedPrompter({ checkbox: [['jira']], input: ['u', 'e', 'p', 'Bug', '24', ''], password: ['t'], confirm: [false] });
  const output = await runInitWizard(prompter);
  assert.equal(typeof output, 'string');
});
