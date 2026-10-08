# gh-slack-notify

A GitHub Action to send PR / Issue / Workflow events to Slack and post daily summaries.

## Features

- **PR notifications**: Posted when a PR is opened or ready for review
- **Issue notifications**: Posted when an issue is opened
- **Workflow notifications**: Success / Failure alerts
- **Daily summary**: Consolidate notifications and clean up channel
- **Filtering**: Control notifications by labels or Project linkage

## Usage

### Basic Setup

```yaml
name: Slack Notify

on:
  pull_request:
    types: [opened, ready_for_review]
  issues:
    types: [opened, ready_for_review]
    types: [opened]
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
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
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
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
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
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
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
          slack_channel: ${{ secrets.SLACK_CHANNEL_ID }}
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
| `base_branches` | No | `all` | Target base branches for PR notifications (e.g., `main`, `main,develop`) |

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
- `channels:history` - Read channel history to find notifications (`groups:history` for private channels)

## Message Tracking

Opened notifications carry Slack message metadata (`gh_slack_notify_item`), and each Daily Summary carries `gh_slack_notify_summary`. The summary reads the last 14 days of channel history to find them, so no state storage is needed. `encryption_key` and the `actions: write` permission are no longer required.

## Closed / Merged

Closed and merged events are not notified individually, so you can drop `closed` from the `pull_request` / `issues` triggers. The summary fetches closed PRs and issues from the GitHub API for the period since the previous summary (24 hours when there is none):

- Merged / Closed PRs: draft PRs are excluded, and the label and base branch filters are applied
- Closed issues: PRs are excluded, and the label filter is applied
- The summary job needs these permissions:

```yaml
permissions:
  contents: read
  pull-requests: read
  issues: read
```

The summary deletes the opened notifications it consumed; Daily Summary messages are kept.

## License

MIT
