import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/web-api';
import type { ItemKind, ItemMetadataPayload, TrackedItem } from './types.js';

export const ITEM_EVENT_TYPE = 'gh_slack_notify_item';
const HISTORY_LOOKBACK_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 200;

let client: WebClient | null = null;

export function initSlackClient(token: string): WebClient {
  client = new WebClient(token);
  return client;
}

export function getSlackClient(): WebClient {
  if (!client) {
    throw new Error('Slack client not initialized. Call initSlackClient first.');
  }
  return client;
}

// Truncate text without splitting UTF-16 surrogate pairs (e.g. emoji)
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  let end = maxLength;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }

  return text.substring(0, end) + '...';
}

// Send a message to Slack
export async function postMessage(
  channel: string,
  blocks: KnownBlock[],
  text: string,
  options?: {
    threadTs?: string;
    replyBroadcast?: boolean;
    color?: string;
    metadata?: ItemMetadataPayload;
  }
): Promise<string> {
  const slack = getSlackClient();
  const { threadTs, replyBroadcast, color, metadata } = options ?? {};
  const messageMetadata = metadata
    ? { event_type: ITEM_EVENT_TYPE, event_payload: { ...metadata } }
    : undefined;

  // colorが指定されている場合はattachmentsを使う
  const baseOptions = color
    ? {
        channel,
        attachments: [{ color, blocks }],
        text,
        metadata: messageMetadata,
        unfurl_links: false as const,
        unfurl_media: false as const,
      }
    : {
        channel,
        blocks,
        text,
        metadata: messageMetadata,
        unfurl_links: false as const,
        unfurl_media: false as const,
      };

  const result = threadTs
    ? await slack.chat.postMessage({
        ...baseOptions,
        thread_ts: threadTs,
        reply_broadcast: replyBroadcast ?? false,
      })
    : await slack.chat.postMessage(baseOptions);

  if (!result.ok || !result.ts) {
    throw new Error(`Failed to post message: ${result.error}`);
  }

  return result.ts;
}

export async function deleteMessage(channel: string, ts: string): Promise<boolean> {
  const slack = getSlackClient();
  try {
    const result = await slack.chat.delete({
      channel,
      ts,
    });
    return result.ok === true;
  } catch (error) {
    if (isMessageNotFound(error)) {
      return true;
    }
    console.warn(`Failed to delete message ${ts}: ${error}`);
    return false;
  }
}

function isMessageNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof error.data === 'object' &&
    error.data !== null &&
    'error' in error.data &&
    error.data.error === 'message_not_found'
  );
}

interface SlackMessageLike {
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  bot_id?: string;
  metadata?: { event_type?: string; event_payload?: unknown };
}

const ITEM_KINDS: readonly string[] = ['pr', 'issue'];
const ITEM_EVENTS: readonly string[] = ['opened', 'closed', 'merged'];

function parseTrackedItem(message: SlackMessageLike, botId: string, repo: string): TrackedItem | null {
  const { ts, metadata } = message;
  if (!ts || message.bot_id !== botId || metadata?.event_type !== ITEM_EVENT_TYPE) {
    return null;
  }

  const payload = metadata.event_payload as Partial<Record<keyof ItemMetadataPayload, unknown>> | undefined;
  if (
    !payload ||
    payload.repo !== repo ||
    typeof payload.kind !== 'string' ||
    !ITEM_KINDS.includes(payload.kind) ||
    typeof payload.event !== 'string' ||
    !ITEM_EVENTS.includes(payload.event) ||
    typeof payload.number !== 'number'
  ) {
    return null;
  }

  return {
    kind: payload.kind as ItemKind,
    repo,
    number: payload.number,
    title: String(payload.title ?? ''),
    url: String(payload.url ?? ''),
    event: payload.event as TrackedItem['event'],
    ts,
    threadTs: message.thread_ts && message.thread_ts !== ts ? message.thread_ts : null,
    replyCount: message.reply_count ?? 0,
  };
}

async function getOwnBotId(): Promise<string> {
  const auth = await getSlackClient().auth.test();
  if (!auth.bot_id) {
    throw new Error('auth.test did not return bot_id. A bot token (xoxb-) is required.');
  }
  return auth.bot_id;
}

async function listHistoryItems(channel: string, repo: string, botId: string): Promise<TrackedItem[]> {
  const slack = getSlackClient();
  const oldest = ((Date.now() - HISTORY_LOOKBACK_DAYS * MS_PER_DAY) / 1000).toString();
  const items: TrackedItem[] = [];
  let cursor: string | undefined;

  do {
    const page = await slack.conversations.history({
      channel,
      oldest,
      include_all_metadata: true,
      limit: PAGE_SIZE,
      cursor,
    });
    for (const message of page.messages ?? []) {
      const item = parseTrackedItem(message, botId, repo);
      if (item) {
        items.push(item);
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return items;
}

async function listReplyItems(channel: string, parentTs: string, repo: string, botId: string): Promise<TrackedItem[]> {
  const slack = getSlackClient();
  const items: TrackedItem[] = [];
  let cursor: string | undefined;

  do {
    const page = await slack.conversations.replies({
      channel,
      ts: parentTs,
      include_all_metadata: true,
      limit: PAGE_SIZE,
      cursor,
    });
    for (const message of page.messages ?? []) {
      const item = parseTrackedItem(message, botId, repo);
      if (item && item.threadTs !== null) {
        items.push(item);
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return items;
}

export async function findOpenedThreadTs(
  channel: string,
  repo: string,
  kind: ItemKind,
  number: number
): Promise<string | null> {
  const botId = await getOwnBotId();
  const items = await listHistoryItems(channel, repo, botId);
  const opened = items.find(
    (item) => item.event === 'opened' && item.kind === kind && item.number === number && item.threadTs === null
  );
  return opened?.ts ?? null;
}

// Includes thread replies (not only broadcasted ones), deduplicated by ts
export async function listTrackedItems(channel: string, repo: string): Promise<TrackedItem[]> {
  const botId = await getOwnBotId();
  const historyItems = await listHistoryItems(channel, repo, botId);
  const itemsByTs = new Map(historyItems.map((item) => [item.ts, item]));

  for (const parent of historyItems.filter((item) => item.threadTs === null && item.replyCount > 0)) {
    for (const reply of await listReplyItems(channel, parent.ts, repo, botId)) {
      itemsByTs.set(reply.ts, reply);
    }
  }

  return [...itemsByTs.values()];
}

// Build PR message blocks
export function buildPRBlocks(params: {
  action: 'opened' | 'closed' | 'merged';
  title: string;
  url: string;
  number: number;
  repo: string;
  author: string;
  body?: string;
  reviewers?: string[];
}): KnownBlock[] {
  const { action, title, url, number, repo, author, body, reviewers } = params;

  let emoji: string;
  let statusText: string;

  switch (action) {
    case 'opened':
      emoji = ':trident:';
      statusText = 'opened';
      break;
    case 'merged':
      emoji = ':feet:';
      statusText = 'merged';
      break;
    case 'closed':
      emoji = ':ballot_box_with_check:';
      statusText = 'closed';
      break;
  }

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Pull Request ${statusText}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${url}|#${number}: ${title}>`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🏰 ${repo} • 🫅 ${author}`,
        },
      ],
    },
  ];

  // レビュアー情報を追加
  if (reviewers && reviewers.length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `👀 Reviewers: ${reviewers.join(', ')}`,
        },
      ],
    });
  }

  if (body && action === 'opened') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateText(body, 200),
      },
    });
  }

  return blocks;
}

// Build Issue message blocks
export function buildIssueBlocks(params: {
  action: 'opened' | 'closed';
  title: string;
  url: string;
  number: number;
  repo: string;
  author: string;
  body?: string;
}): KnownBlock[] {
  const { action, title, url, number, repo, author, body } = params;

  const emoji = action === 'opened' ? ':raised_hand:' : ':feet:';
  const statusText = action === 'opened' ? 'opened' : 'closed';

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Issue ${statusText}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${url}|#${number}: ${title}>`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🏰 ${repo} • 🫅 ${author}`,
        },
      ],
    },
  ];

  if (body && action === 'opened') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateText(body, 200),
      },
    });
  }

  return blocks;
}

// Build Workflow run message blocks
export function buildWorkflowBlocks(params: {
  conclusion: 'success' | 'failure';
  workflowName: string;
  runUrl: string;
  repo: string;
  branch: string;
  duration?: number;
}): KnownBlock[] {
  const { conclusion, workflowName, runUrl, repo, branch, duration } = params;

  const emoji = conclusion === 'success' ? '✅' : '❌';
  const statusText = conclusion === 'success' ? 'succeeded' : 'failed';

  const durationText = duration ? ` • ⏱️ ${duration}s` : '';

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Workflow ${statusText}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${runUrl}|${workflowName}>`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🏰 ${repo} • 🌿 ${branch}${durationText}`,
        },
      ],
    },
  ];

  return blocks;
}
