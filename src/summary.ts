import type { KnownBlock } from '@slack/web-api';
import * as core from '@actions/core';
import { postMessage, deleteMessage, listTrackedItems } from './slack.js';
import type { TrackedItem } from './types.js';

interface SummaryData {
  prs: {
    opened: TrackedItem[];
    merged: TrackedItem[];
    closed: TrackedItem[];
  };
  issues: {
    opened: TrackedItem[];
    closed: TrackedItem[];
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

function collectSummaryData(items: TrackedItem[]): SummaryData {
  const latestByItem = new Map<string, TrackedItem>();
  for (const item of items) {
    const key = `${item.kind}#${item.number}`;
    const current = latestByItem.get(key);
    if (!current || Number(item.ts) > Number(current.ts)) {
      latestByItem.set(key, item);
    }
  }

  const data: SummaryData = {
    prs: { opened: [], merged: [], closed: [] },
    issues: { opened: [], closed: [] },
  };

  for (const item of latestByItem.values()) {
    if (item.kind === 'pr') {
      if (item.event === 'opened' || item.event === 'merged' || item.event === 'closed') {
        data.prs[item.event].push(item);
      }
    } else if (item.event === 'opened' || item.event === 'closed') {
      data.issues[item.event].push(item);
    }
  }

  return data;
}

// Build summary message blocks
function buildSummaryBlocks(data: SummaryData, repository: string): KnownBlock[] {
  const today = new Date().toISOString().split('T')[0];
  const summaryTitle = repository
    ? `:scroll: Daily Summary (${repository}) - ${today}`
    : `:scroll: Daily Summary - ${today}`;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: summaryTitle,
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
      (item) => `• <${item.url}|#${item.number}: ${item.title}>`
    );
    pushSummarySection(blocks, 'Pull Requests / Opened', prOpenedLines);

    const prClosedLines = data.prs.closed.map(
      (item) => `• <${item.url}|#${item.number}: ${item.title}>`
    );
    pushSummarySection(blocks, 'Pull Requests / Closed', prClosedLines);

    const prMergedLines = data.prs.merged.map(
      (item) => `• <${item.url}|#${item.number}: ${item.title}>`
    );
    pushSummarySection(blocks, 'Pull Requests / Merged', prMergedLines);
  }

  // Issue sections
  const hasIssues = data.issues.opened.length > 0 || data.issues.closed.length > 0;

  if (hasIssues) {
    const issueOpenedLines = data.issues.opened.map(
      (item) => `• <${item.url}|#${item.number}: ${item.title}>`
    );
    pushSummarySection(blocks, 'Issues / Opened', issueOpenedLines);

    const issueClosedLines = data.issues.closed.map(
      (item) => `• <${item.url}|#${item.number}: ${item.title}>`
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

// Replies go first: deleting the parent first leaves a "message was deleted" stub
async function deleteTrackedItems(items: TrackedItem[], channel: string): Promise<void> {
  const replies = items.filter((item) => item.threadTs !== null);
  const parents = items.filter((item) => item.threadTs === null);

  core.info(`Deleting ${items.length} messages...`);

  for (const item of [...replies, ...parents]) {
    const label = `${item.kind === 'pr' ? 'PR' : 'Issue'}${item.threadTs !== null ? ' reply' : ''} #${item.number}`;
    if (await deleteMessage(channel, item.ts)) {
      core.info(`Deleted ${label} message`);
    } else {
      core.warning(`Failed to delete ${label} message`);
    }
  }
}

export async function runSummary(channel: string, repository: string): Promise<void> {
  core.info('Running daily summary...');

  const items = await listTrackedItems(channel, repository);
  const blocks = buildSummaryBlocks(collectSummaryData(items), repository);
  const text = repository ? `Daily Summary (${repository})` : 'Daily Summary';

  await postMessage(channel, blocks, text);
  core.info('Summary posted to Slack');

  await deleteTrackedItems(items, channel);

  core.info('Daily summary completed');
}
