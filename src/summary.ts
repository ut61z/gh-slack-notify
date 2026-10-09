import type { KnownBlock } from '@slack/web-api';
import * as core from '@actions/core';
import { postMessage, deleteMessage, listChannelActivity, SUMMARY_EVENT_TYPE } from './slack.js';
import {
  listClosedPullRequests,
  listClosedIssues,
  shouldNotifyByLabels,
  shouldNotifyByBaseBranch,
} from './github.js';
import type { ActionInputs, TrackedItem } from './types.js';

export type SummaryFilters = Pick<ActionInputs, 'labelFilterMode' | 'filterLabels' | 'baseBranches'>;

interface SummaryEntry {
  number: number;
  title: string;
  url: string;
}

interface SummaryData {
  prs: {
    opened: SummaryEntry[];
    merged: SummaryEntry[];
    closed: SummaryEntry[];
  };
  issues: {
    opened: SummaryEntry[];
    closed: SummaryEntry[];
  };
}

const MAX_SECTION_TEXT_LENGTH = 3000;
const DEFAULT_SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;

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

function uniqueByNumber(entries: SummaryEntry[]): SummaryEntry[] {
  return [...new Map(entries.map((entry) => [entry.number, entry])).values()];
}

function toSummaryLine(entry: SummaryEntry): string {
  return `• <${entry.url}|#${entry.number}: ${entry.title}>`;
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

  const hasPRs =
    data.prs.opened.length > 0 ||
    data.prs.merged.length > 0 ||
    data.prs.closed.length > 0;

  if (hasPRs) {
    pushSummarySection(blocks, 'Pull Requests / Opened', data.prs.opened.map(toSummaryLine));
    pushSummarySection(blocks, 'Pull Requests / Closed', data.prs.closed.map(toSummaryLine));
    pushSummarySection(blocks, 'Pull Requests / Merged', data.prs.merged.map(toSummaryLine));
  }

  const hasIssues = data.issues.opened.length > 0 || data.issues.closed.length > 0;

  if (hasIssues) {
    pushSummarySection(blocks, 'Issues / Opened', data.issues.opened.map(toSummaryLine));
    pushSummarySection(blocks, 'Issues / Closed', data.issues.closed.map(toSummaryLine));
  }

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

async function deleteTrackedItems(items: TrackedItem[], channel: string): Promise<void> {
  core.info(`Deleting ${items.length} messages...`);

  for (const item of items) {
    const label = `${item.kind === 'pr' ? 'PR' : 'Issue'} #${item.number}`;
    if (await deleteMessage(channel, item.ts)) {
      core.info(`Deleted ${label} message`);
    } else {
      core.warning(`Failed to delete ${label} message`);
    }
  }
}

export async function runSummary(
  channel: string,
  repository: string,
  filters: SummaryFilters
): Promise<void> {
  core.info('Running daily summary...');

  const [owner, repo] = repository.split('/') as [string, string];
  const { items, lastSummaryTs } = await listChannelActivity(channel, repository);
  const since = lastSummaryTs
    ? new Date(Number(lastSummaryTs) * 1000)
    : new Date(Date.now() - DEFAULT_SUMMARY_WINDOW_MS);

  const closedPulls = (await listClosedPullRequests(owner, repo, since)).filter(
    (pr) =>
      !pr.draft &&
      shouldNotifyByLabels(pr.labels, filters.labelFilterMode, filters.filterLabels) &&
      shouldNotifyByBaseBranch(pr.baseBranch, filters.baseBranches)
  );
  const closedIssues = (await listClosedIssues(owner, repo, since)).filter((issue) =>
    shouldNotifyByLabels(issue.labels, filters.labelFilterMode, filters.filterLabels)
  );

  const closedPullNumbers = new Set(closedPulls.map((pr) => pr.number));
  const closedIssueNumbers = new Set(closedIssues.map((issue) => issue.number));
  const openedPulls = items.filter((item) => item.kind === 'pr' && !closedPullNumbers.has(item.number));
  const openedIssues = items.filter((item) => item.kind === 'issue' && !closedIssueNumbers.has(item.number));

  const data: SummaryData = {
    prs: {
      opened: uniqueByNumber(openedPulls),
      merged: closedPulls.filter((pr) => pr.merged),
      closed: closedPulls.filter((pr) => !pr.merged),
    },
    issues: {
      opened: uniqueByNumber(openedIssues),
      closed: closedIssues,
    },
  };

  const text = repository ? `Daily Summary (${repository})` : 'Daily Summary';
  await postMessage(channel, buildSummaryBlocks(data, repository), text, {
    metadata: { eventType: SUMMARY_EVENT_TYPE, payload: { repo: repository } },
  });
  core.info('Summary posted to Slack');

  await deleteTrackedItems(items, channel);

  core.info('Daily summary completed');
}
