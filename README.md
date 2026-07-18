# crashrelay

Catch backend crashes, HTTP 5xx responses, and error-log lines — plus
frontend JS errors via [`crashrelay-browser`](https://github.com/Rifat024/crashrelay-browser)
— and auto-file tickets in Jira or GitHub Issues.

## The one thing to understand before using this

**Crash/HTTP-5xx capture is a library you embed in your own app, not a
process that watches another process from the outside.** A separate daemon
cannot hook `uncaughtException`/`unhandledRejection` in a *different* OS
process — that's a Node/OS limitation, not a design choice. So:

- `require('crashrelay').installCrashHandlers(...)` / `httpStatusMiddleware(...)`
  / `expressErrorHandler(...)` run **inside your own server's process**.
- `crashrelay start` runs the two pieces that genuinely *can* be a separate
  always-on daemon: log-file tailing, and the ingestion endpoint that
  receives frontend error beacons from `crashrelay-browser`.

Both pieces ship in this one package — it's just that "backend crash
detection" and "standalone daemon" are different things wearing the same
npm install.

**On "24/7"**: `crashrelay start` is a foreground Node process. Surviving a
crash, an OOM kill, or a server reboot needs an external supervisor —
`pm2`, `systemd`, or a Docker restart policy. This package reports crashes;
it doesn't resurrect its own killed process.

## Install

```bash
npm install crashrelay
```

## Setup

```bash
npx crashrelay init
```

Interactive wizard — prompts for Jira and/or GitHub Issues credentials, and
prints an `export KEY="value"` block. **It never writes a file.** Load the
output into your process manager, systemd unit, or Docker secrets — this
tool only ever reads credentials from environment variables.

```bash
npx crashrelay test-ticket          # dry-run connectivity check
npx crashrelay test-ticket --live   # creates one real test ticket
```

## Usage

### 1. Embed crash + HTTP-5xx capture in your own app

```ts
import { installCrashHandlers, loadConfig, resolveProviders, realFetcher, createPipeline } from 'crashrelay';

const config = loadConfig();
const pipeline = createPipeline(config, resolveProviders(config, realFetcher));

installCrashHandlers(pipeline.handleDefect);
```

For HTTP 5xx (Express/Connect):

```ts
import { httpStatusMiddleware, expressErrorHandler } from 'crashrelay';

app.use(httpStatusMiddleware(pipeline.handleDefect)); // status-code-only, works with any framework
app.use(expressErrorHandler(pipeline.handleDefect));  // captures the actual Error, Express/Connect only — mount last
```

Fastify doesn't support 4-arg error middleware at all — call `reportDefect`
directly from `fastify.setErrorHandler()` instead:

```ts
import { reportDefect } from 'crashrelay';
fastify.setErrorHandler((err, req) => reportDefect(pipeline.handleDefect, err, { route: req.url }));
```

### 2. Run the standalone daemon (log tailing + frontend ingestion)

```bash
npx crashrelay start
```

Runs under whatever supervisor you use for the rest of your stack (pm2,
systemd, Docker).

### 3. Check status

```bash
npx crashrelay status
```

## Environment variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | Jira | All four or none |
| `JIRA_ISSUE_TYPE` | Jira | Default `Bug` |
| `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` | GitHub Issues | All three or none |
| `INGESTION_TOKEN` | Frontend ingestion | Enables the endpoint when set. Public "write key" (like a Sentry DSN) — not confidential, readable in browser devtools |
| `INGESTION_PORT` | Frontend ingestion | Default `4318` |
| `INGESTION_ALLOWED_ORIGINS` | Frontend ingestion | Comma-separated CORS allowlist |
| `DEDUP_COOLDOWN_HOURS` | — | Default `24` |
| `COMMENT_COOLDOWN_MINUTES` | — | Default `60` |
| `LOG_TAIL_PATH`, `LOG_TAIL_PATTERN` | Log tailing | Pattern default `ERROR` |

If both Jira and GitHub are configured, Jira is used — the dedup cache
stores one ticket per fingerprint, not one per provider, so only the first
configured provider actually creates/owns tickets.

## Deduplication

Repeated identical crashes don't spam a ticket per occurrence. Each defect
is fingerprinted (message + top stack frames, with IDs/timestamps/addresses
normalized out) and checked against a local cache
(`.crashrelay-dedup-cache.json`):

- New fingerprint, or past its cooldown (`DEDUP_COOLDOWN_HOURS`, default
  24h) → creates a ticket.
- Same fingerprint within the cooldown → adds a "seen again ×N" comment on
  the existing ticket (throttled separately by `COMMENT_COOLDOWN_MINUTES` so
  a tight crash loop doesn't spam comments either).

This caps tickets **per fingerprint per window** — distinct crash
signatures each still get their own ticket. If a human closes a ticket and
the same fingerprint recurs inside the cooldown, v1 comments on the closed
ticket rather than reopening or filing a new one.

## Frontend errors

Pair with [`crashrelay-browser`](https://github.com/Rifat024/crashrelay-browser):

```ts
import { initErrorReporter } from 'crashrelay-browser';

initErrorReporter({
  endpoint: 'https://your-api.example.com/report',
  token: process.env.CRASHRELAY_INGESTION_TOKEN, // the public write key from `crashrelay init`
});
```

## Limitations

- Not a guarantee of 24/7 uptime — that's an infra/supervisor concern layered on top.
- Log tailing is single-instance; running multiple daemon replicas without a shared store multiplies first-occurrence tickets by replica count.
- No ticket-status awareness — a closed ticket that recurs within its cooldown gets a comment, not a reopen.
- `INGESTION_TOKEN` is a public write key, not a secret — its abuse-mitigation is rate-limiting and dedup, not confidentiality.
