import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/web-api';
import { COLORS } from './types.js';

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

// Send a message to Slack
export async function postMessage(
  channel: string,
  blocks: KnownBlock[],
  text: string,
  options?: {
    threadTs?: string;
    replyBroadcast?: boolean;
    color?: string;
  }
): Promise<string> {
  const slack = getSlackClient();
  const { threadTs, replyBroadcast, color } = options ?? {};

  // colorが指定されている場合はattachmentsを使う
  const baseOptions = color
    ? {
        channel,
        attachments: [{ color, blocks }],
        text,
        unfurl_links: false as const,
        unfurl_media: false as const,
      }
    : {
        channel,
        blocks,
        text,
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

// Delete a message from Slack
export async function deleteMessage(channel: string, ts: string): Promise<boolean> {
  const slack = getSlackClient();
  try {
    const result = await slack.chat.delete({
      channel,
      ts,
    });
    return result.ok === true;
  } catch (error) {
    console.warn(`Failed to delete message ${ts}: ${error}`);
    return false;
  }
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
      emoji = '🚀';
      statusText = 'opened';
      break;
    case 'merged':
      emoji = '✅';
      statusText = 'merged';
      break;
    case 'closed':
      emoji = '❌';
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
    const truncatedBody = body.length > 200 ? body.substring(0, 200) + '...' : body;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedBody,
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

  const emoji = action === 'opened' ? '🐛' : '✅';
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
    const truncatedBody = body.length > 200 ? body.substring(0, 200) + '...' : body;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedBody,
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
