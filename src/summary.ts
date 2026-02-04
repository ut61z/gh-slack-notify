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

const MAX_SECTION_TEXT_LENGTH = 3000;

function pushSummarySection(
  blocks: KnownBlock[],
  title: string,
  lines: string[]
): void {
  if (lines.length === 0) {
    return;
  }

  let currentTitle = title;
  let chunk: string[] = [`*${currentTitle}*`];

  for (const line of lines) {
    const nextText = [...chunk, line].join('\n');
    if (nextText.length < MAX_SECTION_TEXT_LENGTH) {
      chunk.push(line);
      continue;
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: chunk.join('\n'),
      },
    });

    currentTitle = `${title} (cont.)`;
    chunk = [`*${currentTitle}*`, line];
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: chunk.join('\n'),
    },
  });
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
        text: `:scroll: Daily Summary - ${today}`,
        emoji: true,
      },
    },
  ];

  // PR sections
  const hasPRs =
    data.prs.opened.length > 0 ||
    data.prs.merged.length > 0 ||
    data.prs.closed.length > 0;

  if (hasPRs) {
    const prOpenedLines = data.prs.opened.map(
      ({ number, entry }) => `• <${entry.url}|#${number}: ${entry.title}>`
    );
    pushSummarySection(blocks, 'Pull Requests / Opened', prOpenedLines);

    const prClosedLines = data.prs.closed.map(
      ({ number, entry }) => `• <${entry.url}|#${number}: ${entry.title}>`
    );
    pushSummarySection(blocks, 'Pull Requests / Closed', prClosedLines);

    const prMergedLines = data.prs.merged.map(
      ({ number, entry }) => `• <${entry.url}|#${number}: ${entry.title}>`
    );
    pushSummarySection(blocks, 'Pull Requests / Merged', prMergedLines);
  }

  // Issue sections
  const hasIssues = data.issues.opened.length > 0 || data.issues.closed.length > 0;

  if (hasIssues) {
    const issueOpenedLines = data.issues.opened.map(
      ({ number, entry }) => `• <${entry.url}|#${number}: ${entry.title}>`
    );
    pushSummarySection(blocks, 'Issues / Opened', issueOpenedLines);

    const issueClosedLines = data.issues.closed.map(
      ({ number, entry }) => `• <${entry.url}|#${number}: ${entry.title}>`
    );
    pushSummarySection(blocks, 'Issues / Closed', issueClosedLines);
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
  const messagesToDelete: Array<{ type: string; number: string; ts: string; isReply?: boolean }> = [];

  // Collect PR messages
  for (const [number, entry] of Object.entries(state.pull_requests)) {
    if (entry.channel === channel) {
      if (entry.message_ts) {
        messagesToDelete.push({ type: 'PR', number, ts: entry.message_ts });
      }
      if (entry.reply_message_ts) {
        messagesToDelete.push({ type: 'PR', number, ts: entry.reply_message_ts, isReply: true });
      }
    }
  }

  // Collect Issue messages
  for (const [number, entry] of Object.entries(state.issues)) {
    if (entry.channel === channel) {
      if (entry.message_ts) {
        messagesToDelete.push({ type: 'Issue', number, ts: entry.message_ts });
      }
      if (entry.reply_message_ts) {
        messagesToDelete.push({ type: 'Issue', number, ts: entry.reply_message_ts, isReply: true });
      }
    }
  }

  core.info(`Deleting ${messagesToDelete.length} messages...`);

  for (const msg of messagesToDelete) {
    const success = await deleteMessage(channel, msg.ts);
    const msgType = msg.isReply ? `${msg.type} reply` : msg.type;
    if (success) {
      core.info(`Deleted ${msgType} #${msg.number} message`);
    } else {
      core.warning(`Failed to delete ${msgType} #${msg.number} message`);
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

  // 6. Save state (skipMerge=trueでクリア後の状態を上書き)
  await saveState(state, true);

  core.info('Daily summary completed');
}
