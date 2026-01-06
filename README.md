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

PR/Issue notifications are stored in `.github/slack-notifications.json` to enable thread replies on Close/Merge events.

## License

MIT
