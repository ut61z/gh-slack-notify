import { describe, expect, mock, test } from 'bun:test';
import { initSlackClient, findOpenedThreadTs, listTrackedItems, deleteMessage, postMessage, ITEM_EVENT_TYPE } from './slack.js';
import { runSummary } from './summary.js';
import type { ItemMetadataPayload } from './types.js';

const CHANNEL = 'C123';
const REPO = 'owner/repo';
const BOT_ID = 'B_SELF';

function tagged(ts: string, payload: Partial<ItemMetadataPayload>, extra: Record<string, unknown> = {}) {
  return {
    ts,
    bot_id: BOT_ID,
    metadata: {
      event_type: ITEM_EVENT_TYPE,
      event_payload: { kind: 'pr', repo: REPO, number: 1, title: 't', url: 'https://example.com/1', event: 'opened', ...payload },
    },
    ...extra,
  };
}

interface FakeSlack {
  history: ReturnType<typeof mock>;
  replies: ReturnType<typeof mock>;
  del: ReturnType<typeof mock>;
  post: ReturnType<typeof mock>;
}

function setupSlack(options: {
  historyPages: Array<Record<string, unknown>[]>;
  repliesByParent?: Record<string, Record<string, unknown>[]>;
  deleteError?: (ts: string) => unknown;
}): FakeSlack {
  const client = initSlackClient('xoxb-test');
  const history = mock(async ({ cursor }: { cursor?: string }) => {
    const index = cursor ? Number(cursor) : 0;
    const next = index + 1 < options.historyPages.length ? String(index + 1) : '';
    return { ok: true, messages: options.historyPages[index], response_metadata: { next_cursor: next } };
  });
  const replies = mock(async ({ ts }: { ts: string }) => ({
    ok: true,
    messages: options.repliesByParent?.[ts] ?? [],
    response_metadata: { next_cursor: '' },
  }));
  const del = mock(async ({ ts }: { ts: string }) => {
    const error = options.deleteError?.(ts);
    if (error) {
      throw error;
    }
    return { ok: true };
  });
  const post = mock(async (_args: Record<string, unknown>) => ({ ok: true, ts: '9999.0001' }));

  Object.assign(client.auth, { test: mock(async () => ({ ok: true, bot_id: BOT_ID })) });
  Object.assign(client.conversations, { history, replies });
  Object.assign(client.chat, { delete: del, postMessage: post });
  return { history, replies, del, post };
}

const messageNotFound = { data: { error: 'message_not_found' } };

describe('postMessage', () => {
  test('metadataを渡すとevent_typeとpayload付きで投稿する', async () => {
    const slack = setupSlack({ historyPages: [[]] });
    const payload: ItemMetadataPayload = { kind: 'issue', repo: REPO, number: 5, title: 'x', url: 'u', event: 'opened' };

    await postMessage(CHANNEL, [], '', { metadata: payload });

    expect(slack.post.mock.calls[0]![0]).toMatchObject({
      metadata: { event_type: ITEM_EVENT_TYPE, event_payload: payload },
    });
  });
});

describe('findOpenedThreadTs', () => {
  test('repo, kind, numberが一致する最新のopened親を返す', async () => {
    setupSlack({
      historyPages: [[
        tagged('300.0', { number: 7, event: 'opened' }),
        tagged('200.0', { number: 7, event: 'opened' }),
        tagged('100.0', { number: 8, event: 'opened' }),
      ]],
    });

    expect(await findOpenedThreadTs(CHANNEL, REPO, 'pr', 7)).toBe('300.0');
  });

  test('cursorをたどって次のページも探す', async () => {
    const slack = setupSlack({
      historyPages: [[tagged('300.0', { number: 1 })], [tagged('100.0', { number: 7 })]],
    });

    expect(await findOpenedThreadTs(CHANNEL, REPO, 'pr', 7)).toBe('100.0');
    expect(slack.history).toHaveBeenCalledTimes(2);
  });

  test('他bot・他repo・他kind・metadataなし・返信は無視して、見つからなければnull', async () => {
    setupSlack({
      historyPages: [[
        tagged('500.0', { number: 7 }, { bot_id: 'B_OTHER' }),
        tagged('400.0', { number: 7, repo: 'owner/other' }),
        tagged('300.0', { number: 7, kind: 'issue' }),
        { ts: '200.0', bot_id: BOT_ID, text: 'plain' },
        tagged('100.0', { number: 7, event: 'merged' }, { thread_ts: '50.0' }),
      ]],
    });

    expect(await findOpenedThreadTs(CHANNEL, REPO, 'pr', 7)).toBeNull();
  });
});

describe('listTrackedItems', () => {
  test('返信は履歴とrepliesの両方に出てもtsで重複排除する', async () => {
    const broadcast = tagged('150.0', { number: 1, event: 'merged' }, { thread_ts: '100.0' });
    const slack = setupSlack({
      historyPages: [[broadcast, tagged('100.0', { number: 1 }, { reply_count: 1, thread_ts: '100.0' })]],
      repliesByParent: {
        '100.0': [tagged('100.0', { number: 1 }, { thread_ts: '100.0' }), broadcast],
      },
    });

    const items = await listTrackedItems(CHANNEL, REPO);

    expect(items.map((item) => item.ts).sort()).toEqual(['100.0', '150.0']);
    expect(slack.replies).toHaveBeenCalledTimes(1);
  });

  test('broadcastされない返信もrepliesから拾う', async () => {
    setupSlack({
      historyPages: [[tagged('100.0', { kind: 'issue', number: 3 }, { reply_count: 1, thread_ts: '100.0' })]],
      repliesByParent: {
        '100.0': [
          tagged('100.0', { kind: 'issue', number: 3 }, { thread_ts: '100.0' }),
          tagged('200.0', { kind: 'issue', number: 3, event: 'closed' }, { thread_ts: '100.0' }),
        ],
      },
    });

    const items = await listTrackedItems(CHANNEL, REPO);

    expect(items.map((item) => item.ts).sort()).toEqual(['100.0', '200.0']);
  });
});

describe('deleteMessage', () => {
  test('message_not_foundは成功扱い', async () => {
    setupSlack({ historyPages: [[]], deleteError: () => messageNotFound });
    expect(await deleteMessage(CHANNEL, '1.0')).toBe(true);
  });

  test('それ以外のエラーは失敗扱い', async () => {
    setupSlack({ historyPages: [[]], deleteError: () => ({ data: { error: 'cant_delete_message' } }) });
    expect(await deleteMessage(CHANNEL, '1.0')).toBe(false);
  });
});

describe('runSummary', () => {
  function postedText(slack: FakeSlack): string {
    const blocks = slack.post.mock.calls[0]![0].blocks as Array<{ text?: { text: string } }>;
    return blocks.map((block) => block.text?.text ?? '').join('\n');
  }

  test('numberごとに最新のeventで集約し、Daily Summaryにはmetadataを付けない', async () => {
    const slack = setupSlack({
      historyPages: [[
        tagged('400.0', { kind: 'issue', number: 3, title: 'bug', event: 'closed' }),
        tagged('300.0', { number: 1, title: 'feat', event: 'merged' }, { thread_ts: '100.0' }),
        tagged('200.0', { number: 2, title: 'wip', event: 'opened' }),
        tagged('100.0', { number: 1, title: 'feat', event: 'opened' }, { reply_count: 1, thread_ts: '100.0' }),
      ]],
      repliesByParent: {
        '100.0': [tagged('100.0', { number: 1 }, { thread_ts: '100.0' }), tagged('300.0', { number: 1, title: 'feat', event: 'merged' }, { thread_ts: '100.0' })],
      },
    });

    await runSummary(CHANNEL, REPO);

    const text = postedText(slack);
    expect(text).toContain('Pull Requests / Merged*\n• <https://example.com/1|#1: feat>');
    expect(text).toContain('Pull Requests / Opened*\n• <https://example.com/1|#2: wip>');
    expect(text).toContain('Issues / Closed*\n• <https://example.com/1|#3: bug>');
    expect(text.split('#1: feat').length - 1).toBe(1);
    expect(slack.post.mock.calls[0]![0].metadata).toBeUndefined();
  });

  test('返信を先に消してから親を消す。返信の二重削除はしない', async () => {
    const slack = setupSlack({
      historyPages: [[
        tagged('300.0', { number: 1, event: 'merged' }, { thread_ts: '100.0' }),
        tagged('100.0', { number: 1 }, { reply_count: 1, thread_ts: '100.0' }),
      ]],
      repliesByParent: {
        '100.0': [tagged('100.0', { number: 1 }, { thread_ts: '100.0' }), tagged('300.0', { number: 1, title: 'feat', event: 'merged' }, { thread_ts: '100.0' })],
      },
    });

    await runSummary(CHANNEL, REPO);

    expect(slack.del.mock.calls.map(([args]) => (args as { ts: string }).ts)).toEqual(['300.0', '100.0']);
  });

  test('他bot・他repo・metadataなしのメッセージは集計も削除もしない', async () => {
    const slack = setupSlack({
      historyPages: [[
        tagged('300.0', { number: 1 }, { bot_id: 'B_OTHER' }),
        tagged('200.0', { number: 2, repo: 'owner/other' }),
        { ts: '100.0', bot_id: BOT_ID, text: 'Daily Summary' },
      ]],
    });

    await runSummary(CHANNEL, REPO);

    expect(postedText(slack)).toContain('No activity today');
    expect(slack.del).not.toHaveBeenCalled();
  });

  test('message_not_foundでも残りの削除を続ける', async () => {
    const slack = setupSlack({
      historyPages: [[tagged('200.0', { number: 2 }), tagged('100.0', { number: 1 })]],
      deleteError: (ts) => (ts === '200.0' ? messageNotFound : null),
    });

    await runSummary(CHANNEL, REPO);

    expect(slack.del).toHaveBeenCalledTimes(2);
  });
});
