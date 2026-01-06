import type { KnownBlock } from '@slack/web-api';
import * as core from '@actions/core';
import {
  readState,
  saveState,
  clearEntries,
  updateLastSummaryAt,
} from './state.js';
import { postMessage, deleteMessage } from './slack.js';
import type { NotificationState, PullRequestEntry, IssueEntry } from './types.js';

interface SummaryData {
  prs: {
    opened: Array<{ number: string; entry: PullRequestEntry }>;
    merged: Array<{ number: string; entry: PullRequestEntry }>;
    closed: Array<{ number: string; entry: PullRequestEntry }>;
  };
  issues: {
    opened: Array<{ number: string; entry: IssueEntry }>;
    closed: Array<{ number: string; entry: IssueEntry }>;
  };
}

// Collect data for summary since last summary
function collectSummaryData(state: NotificationState): SummaryData {
  const lastSummaryAt = state.last_summary_at
    ? new Date(state.last_summary_at)
    : new Date(0); // If no last summary, include everything

  const data: SummaryData = {
    prs: { opened: [], merged: [], closed: [] },
    issues: { opened: [], closed: [] },
  };

  // Collect PRs
  for (const [number, entry] of Object.entries(state.pull_requests)) {
    const createdAt = new Date(entry.created_at);
    if (createdAt >= lastSummaryAt) {
      switch (entry.event) {
        case 'opened':
          data.prs.opened.push({ number, entry });
          break;
        case 'merged':
          data.prs.merged.push({ number, entry });
          break;
        case 'closed':
          data.prs.closed.push({ number, entry });
          break;
      }
    }
  }

  // Collect Issues
  for (const [number, entry] of Object.entries(state.issues)) {
    const createdAt = new Date(entry.created_at);
    if (createdAt >= lastSummaryAt) {
      switch (entry.event) {
        case 'opened':
          data.issues.opened.push({ number, entry });
          break;
        case 'closed':
          data.issues.closed.push({ number, entry });
          break;
      }
    }
  }

  return data;
}

// Build summary message blocks
function buildSummaryBlocks(data: SummaryData): KnownBlock[] {
  const today = new Date().toISOString().split('T')[0];

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 Daily Summary - ${today}`,
        emoji: true,
      },
    },
  ];

  // PRs section
  const hasPRs =
    data.prs.opened.length > 0 ||
    data.prs.merged.length > 0 ||
    data.prs.closed.length > 0;

  if (hasPRs) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Pull Requests*',
      },
    });

    const prLines: string[] = [];

    if (data.prs.merged.length > 0) {
      prLines.push('✅ *Merged*');
      for (const { number, entry } of data.prs.merged) {
        prLines.push(`• <${entry.url}|#${number}: ${entry.title}>`);
      }
      prLines.push('');
    }

    if (data.prs.opened.length > 0) {
      prLines.push('🚀 *Opened*');
      for (const { number, entry } of data.prs.opened) {
        prLines.push(`• <${entry.url}|#${number}: ${entry.title}>`);
      }
      prLines.push('');
    }

    if (data.prs.closed.length > 0) {
      prLines.push('❌ *Closed*');
      for (const { number, entry } of data.prs.closed) {
        prLines.push(`• <${entry.url}|#${number}: ${entry.title}>`);
      }
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: prLines.join('\n'),
      },
    });
  }

  // Issues section
  const hasIssues = data.issues.opened.length > 0 || data.issues.closed.length > 0;

  if (hasIssues) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Issues*',
      },
    });

    const issueLines: string[] = [];

    if (data.issues.opened.length > 0) {
      issueLines.push('🐛 *Opened*');
      for (const { number, entry } of data.issues.opened) {
        issueLines.push(`• <${entry.url}|#${number}: ${entry.title}>`);
      }
      issueLines.push('');
    }

    if (data.issues.closed.length > 0) {
      issueLines.push('✅ *Closed*');
      for (const { number, entry } of data.issues.closed) {
        issueLines.push(`• <${entry.url}|#${number}: ${entry.title}>`);
      }
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: issueLines.join('\n'),
      },
    });
  }

  // No activity
  if (!hasPRs && !hasIssues) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No activity today_ 🎉',
      },
    });
  }

  return blocks;
}

// Delete all tracked messages
async function deleteTrackedMessages(
  state: NotificationState,
  channel: string
): Promise<void> {
  const messagesToDelete: Array<{ type: string; number: string; ts: string }> = [];

  // Collect PR messages
  for (const [number, entry] of Object.entries(state.pull_requests)) {
    if (entry.channel === channel && entry.message_ts) {
      messagesToDelete.push({ type: 'PR', number, ts: entry.message_ts });
    }
  }

  // Collect Issue messages
  for (const [number, entry] of Object.entries(state.issues)) {
    if (entry.channel === channel && entry.message_ts) {
      messagesToDelete.push({ type: 'Issue', number, ts: entry.message_ts });
    }
  }

  core.info(`Deleting ${messagesToDelete.length} messages...`);

  for (const msg of messagesToDelete) {
    const success = await deleteMessage(channel, msg.ts);
    if (success) {
      core.info(`Deleted ${msg.type} #${msg.number} message`);
    } else {
      core.warning(`Failed to delete ${msg.type} #${msg.number} message`);
    }
  }
}

// Run the daily summary
export async function runSummary(channel: string): Promise<void> {
  core.info('Running daily summary...');

  // 1. Read state
  const state = await readState();

  // 2. Collect summary data
  const data = collectSummaryData(state);

  // 3. Build and send summary message
  const blocks = buildSummaryBlocks(data);
  const text = 'Daily Summary';

  await postMessage(channel, blocks, text);
  core.info('Summary posted to Slack');

  // 4. Delete tracked messages
  await deleteTrackedMessages(state, channel);

  // 5. Clean up state
  clearEntries(state);
  updateLastSummaryAt(state);

  // 6. Save state
  await saveState(state);

  core.info('Daily summary completed');
}
