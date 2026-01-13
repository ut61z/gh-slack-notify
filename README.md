# gh-slack-notify

A GitHub Action to send PR / Issue / Workflow events to Slack with thread replies and daily summaries.

## Features

- **PR notifications**: Open → Merge/Close with thread replies
- **Issue notifications**: Open → Close with thread replies
- **Workflow notifications**: Success / Failure alerts
- **Daily summary**: Consolidate notifications and clean up channel
- **Filtering**: Control notifications by labels or Project linkage

## Usage

### Basic Setup

```yaml
name: Slack Notify

on:
  pull_request:
    types: [opened, closed]
  issues:
    types: [opened, closed]

permissions:
  contents: write

jobs:
  notify-pr:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@v1
        with:
          event_type: pull_request
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: 'C01234567'
          github_token: ${{ secrets.GITHUB_TOKEN }}

  notify-issue:
    if: github.event_name == 'issues'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@v1
        with:
          event_type: issues
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: 'C01234567'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Workflow Notifications

```yaml
on:
  workflow_run:
    workflows: ["CI", "Deploy"]
    types: [completed]

jobs:
  notify-workflow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@v1
        with:
          event_type: workflow_run
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: 'C01234567'
          github_token: ${{ secrets.GITHUB_TOKEN }}
          workflow_names: 'CI,Deploy'
          notify_on: 'success,failure'
```

### Daily Summary

```yaml
on:
  schedule:
    - cron: '59 14 * * *'  # 23:59 JST
  workflow_dispatch:

jobs:
  daily-summary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@v1
        with:
          event_type: summary
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: 'C01234567'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `event_type` | Yes | - | `pull_request`, `issues`, `workflow_run`, or `summary` |
| `slack_token` | Yes | - | Slack Bot Token (`xoxb-...`) |
| `slack_channel` | Yes | - | Slack channel ID (`C01234567`) |
| `github_token` | Yes | - | GitHub Token |
| `label_filter_mode` | No | - | `whitelist` or `blacklist` |
| `filter_labels` | No | - | Comma-separated labels |
| `exclude_project_issues` | No | `true` | Exclude issues linked to GitHub Projects |
| `workflow_names` | No | - | Comma-separated workflow names to notify |
| `notify_on` | No | `success,failure` | `success`, `failure`, or both |

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte key for encrypting state file |
| `DEBUG_MODE` | No | Set to `true` to disable encryption (for local development) |

## Outputs

| Name | Description |
|------|-------------|
| `message_ts` | Slack message timestamp |
| `notified` | Whether a notification was sent (`true`/`false`) |

## Required Slack Permissions

Your Slack App needs these OAuth Scopes:

- `chat:write` - Send messages
- `chat:write.public` - Post to public channels
- `chat:delete` - Delete messages (for summary feature)

## State Management

PR/Issue notifications are stored in `.github/slack-notifications.json` to enable thread replies on Close/Merge events. All entries are encrypted with AES-256-GCM.

### Encryption Setup (Required)

#### 1. Generate an encryption key

```bash
openssl rand -base64 32
```

#### 2. Add to GitHub Secrets

Go to **Settings > Secrets and variables > Actions > New repository secret**

- Name: `ENCRYPTION_KEY`
- Value: The generated base64 string

#### 3. Pass to workflow

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ut61z/gh-slack-notify@v1
        env:
          ENCRYPTION_KEY: ${{ secrets.ENCRYPTION_KEY }}
        with:
          event_type: pull_request
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: 'C01234567'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

Encrypted state file example:

```json
{
  "pull_requests": {
    "11": "enc:iv==:encryptedData==:authTag=="
  }
}
```

### Debug Mode (Local Development)

For local development, set `DEBUG_MODE=true` to disable encryption:

```bash
DEBUG_MODE=true bun run dev
```

In debug mode, data is stored in plain JSON without encryption.

## License

MIT
