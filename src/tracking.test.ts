import { describe, expect, mock, test } from 'bun:test';
import {
  initSlackClient,
  listChannelActivity,
  deleteMessage,
  postMessage,
  ITEM_EVENT_TYPE,
  SUMMARY_EVENT_TYPE,
} from './slack.js';
import { initGitHubClient, getRestClient, listClosedPullRequests, listClosedIssues } from './github.js';
import { runSummary, type SummaryFilters } from './summary.js';
import type { ItemMetadataPayload } from './types.js';

const CHANNEL = 'C123';
const REPO = 'owner/repo';
const BOT_ID = 'B_SELF';
const NO_FILTERS: SummaryFilters = { labelFilterMode: '', filterLabels: [], baseBranches: ['all'] };

function tagged(ts: string, payload: Partial<ItemMetadataPayload>, extra: Record<string, unknown> = {}) {
  return {
    ts,
    bot_id: BOT_ID,
    metadata: {
      event_type: ITEM_EVENT_TYPE,
      event_payload: { kind: 'pr', repo: REPO, number: 1, title: 't', url: 'https://example.com/1', ...payload },
    },
    ...extra,
  };
}

function summaryMessage(ts: string, repo = REPO, extra: Record<string, unknown> = {}) {
  return { ts, bot_id: BOT_ID, metadata: { event_type: SUMMARY_EVENT_TYPE, event_payload: { repo } }, ...extra };
}

function pull(number: number, overrides: Record<string, unknown> = {}) {
  const closedAt = new Date().toISOString();
  return {
    number,
    title: `pr ${number}`,
    html_url: `https://github.com/${REPO}/pull/${number}`,
    labels: [],
    merged_at: closedAt,
    draft: false,
    base: { ref: 'main' },
    updated_at: closedAt,
    closed_at: closedAt,
    ...overrides,
  };
}

function issue(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `issue ${number}`,
    html_url: `https://github.com/${REPO}/issues/${number}`,
    labels: [],
    closed_at: new Date().toISOString(),
    ...overrides,
  };
}

interface FakeSlack {
  history: ReturnType<typeof mock>;
  del: ReturnType<typeof mock>;
  post: ReturnType<typeof mock>;
}

function setupSlack(options: {
  historyPages: Array<Record<string, unknown>[]>;
  deleteError?: (ts: string) => unknown;
}): FakeSlack {
  const client = initSlackClient('xoxb-test');
  const history = mock(async ({ cursor }: { cursor?: string }) => {
    const index = cursor ? Number(cursor) : 0;
    const next = index + 1 < options.historyPages.length ? String(index + 1) : '';
    return { ok: true, messages: options.historyPages[index], response_metadata: { next_cursor: next } };
  });
  const del = mock(async ({ ts }: { ts: string }) => {
    const error = options.deleteError?.(ts);
    if (error) {
      throw error;
    }
    return { ok: true };
  });
  const post = mock(async (_args: Record<string, unknown>) => ({ ok: true, ts: '9999.0001' }));

  Object.assign(client.auth, { test: mock(async () => ({ ok: true, bot_id: BOT_ID })) });
  Object.assign(client.conversations, { history });
  Object.assign(client.chat, { delete: del, postMessage: post });
  return { history, del, post };
}

function setupGitHub(options: { pulls?: unknown[][]; issues?: unknown[][] }) {
  initGitHubClient('token');
  const rest = getRestClient().rest;
  const pullsList = mock(async ({ page }: { page: number }) => ({ data: options.pulls?.[page - 1] ?? [] }));
  const issuesList = mock(async ({ page }: { page: number; since?: string }) => ({ data: options.issues?.[page - 1] ?? [] }));
  Object.assign(rest.pulls, { list: pullsList });
  Object.assign(rest.issues, { listForRepo: issuesList });
  return { pullsList, issuesList };
}

const messageNotFound = { data: { error: 'message_not_found' } };

describe('postMessage', () => {
  test('metadataを渡すとevent_typeとpayload付きで投稿する', async () => {
    const slack = setupSlack({ historyPages: [[]] });
    const payload: ItemMetadataPayload = { kind: 'issue', repo: REPO, number: 5, title: 'x', url: 'u' };

    await postMessage(CHANNEL, [], '', { metadata: { eventType: ITEM_EVENT_TYPE, payload } });

    expect(slack.post.mock.calls[0]![0]).toMatchObject({
      metadata: { event_type: ITEM_EVENT_TYPE, event_payload: payload },
    });
  });
});

describe('listChannelActivity', () => {
  test('cursorをたどって自botの同repoのitemと最新のsummaryを集める', async () => {
    const slack = setupSlack({
      historyPages: [
        [tagged('300.0', { number: 3 }), summaryMessage('250.0')],
        [tagged('100.0', { number: 1 }), summaryMessage('200.0')],
      ],
    });

    const { items, lastSummaryTs } = await listChannelActivity(CHANNEL, REPO);

    expect(items.map((item) => item.ts)).toEqual(['300.0', '100.0']);
    expect(lastSummaryTs).toBe('250.0');
    expect(slack.history).toHaveBeenCalledTimes(2);
  });

  test('他bot・他repo・metadataなしのメッセージは無視する', async () => {
    setupSlack({
      historyPages: [[
        tagged('500.0', { number: 7 }, { bot_id: 'B_OTHER' }),
        tagged('400.0', { number: 7, repo: 'owner/other' }),
        summaryMessage('300.0', 'owner/other'),
        summaryMessage('200.0', REPO, { bot_id: 'B_OTHER' }),
        { ts: '100.0', bot_id: BOT_ID, text: 'plain' },
      ]],
    });

    expect(await listChannelActivity(CHANNEL, REPO)).toEqual({ items: [], lastSummaryTs: null });
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

describe('listClosedPullRequests / listClosedIssues', () => {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const beforeSince = new Date(since.getTime() - 1000).toISOString();

  test('updated_atがsinceより古くなったら打ち切り、closed_atがsince未満は除外する', async () => {
    const github = setupGitHub({
      pulls: [[pull(3), pull(2, { closed_at: beforeSince }), pull(1, { updated_at: beforeSince, closed_at: beforeSince })]],
    });

    const pulls = await listClosedPullRequests('owner', 'repo', since);

    expect(pulls.map((p) => p.number)).toEqual([3]);
    expect(github.pullsList).toHaveBeenCalledTimes(1);
  });

  test('1ページが埋まっていれば次のページも取る', async () => {
    const github = setupGitHub({
      pulls: [Array.from({ length: 100 }, (_, i) => pull(i + 1)), [pull(101)]],
    });

    const pulls = await listClosedPullRequests('owner', 'repo', since);

    expect(pulls).toHaveLength(101);
    expect(github.pullsList).toHaveBeenCalledTimes(2);
  });

  test('issueはPRを除外し、closed_atがsince未満のものも除外する', async () => {
    setupGitHub({
      issues: [[issue(1), issue(2, { pull_request: {} }), issue(3, { closed_at: beforeSince })]],
    });

    const issues = await listClosedIssues('owner', 'repo', since);

    expect(issues.map((i) => i.number)).toEqual([1]);
  });
});

describe('runSummary', () => {
  function postedText(slack: FakeSlack): string {
    const blocks = slack.post.mock.calls[0]![0].blocks as Array<{ text?: { text: string } }>;
    return blocks.map((block) => block.text?.text ?? '').join('\n');
  }

  test('Openedはslack、Merged/ClosedはGitHubから集め、同じ番号はOpenedから外す', async () => {
    const slack = setupSlack({
      historyPages: [[
        tagged('300.0', { number: 2, title: 'wip' }),
        tagged('200.0', { number: 1, title: 'feat' }),
        tagged('100.0', { number: 1, title: 'feat' }),
        tagged('50.0', { kind: 'issue', number: 9, title: 'open issue' }),
      ]],
    });
    setupGitHub({
      pulls: [[pull(1), pull(4, { merged_at: null })]],
      issues: [[issue(5)]],
    });

    await runSummary(CHANNEL, REPO, NO_FILTERS);

    const text = postedText(slack);
    expect(text).toContain('Pull Requests / Opened*\n• <https://example.com/1|#2: wip>');
    expect(text).toContain('Pull Requests / Closed*\n• <https://github.com/owner/repo/pull/4|#4: pr 4>');
    expect(text).toContain('Pull Requests / Merged*\n• <https://github.com/owner/repo/pull/1|#1: pr 1>');
    expect(text).toContain('Issues / Opened*\n• <https://example.com/1|#9: open issue>');
    expect(text).toContain('Issues / Closed*\n• <https://github.com/owner/repo/issues/5|#5: issue 5>');
    expect(text).not.toContain('#1: feat');
  });

  test('draft・labelフィルタ・base branchフィルタで除外する', async () => {
    const slack = setupSlack({ historyPages: [[]] });
    setupGitHub({
      pulls: [[
        pull(1, { draft: true }),
        pull(2, { labels: [{ name: 'skip' }] }),
        pull(3, { base: { ref: 'develop' } }),
        pull(4),
      ]],
      issues: [[issue(5, { labels: [{ name: 'skip' }] }), issue(6)]],
    });

    await runSummary(CHANNEL, REPO, { labelFilterMode: 'blacklist', filterLabels: ['skip'], baseBranches: ['main'] });

    const text = postedText(slack);
    expect(text).toContain('#4: pr 4');
    expect(text).toContain('#6: issue 6');
    for (const excluded of ['#1:', '#2:', '#3:', '#5:']) {
      expect(text).not.toContain(excluded);
    }
  });

  test('前回summaryの時刻をsinceに使い、なければ24時間前にする', async () => {
    setupSlack({ historyPages: [[summaryMessage('1700000000.500000')]] });
    const withSummary = setupGitHub({});
    await runSummary(CHANNEL, REPO, NO_FILTERS);
    expect(withSummary.issuesList.mock.calls[0]![0].since).toBe(new Date(1700000000500).toISOString());

    setupSlack({ historyPages: [[]] });
    const withoutSummary = setupGitHub({});
    const before = Date.now();
    await runSummary(CHANNEL, REPO, NO_FILTERS);
    const since = Date.parse(withoutSummary.issuesList.mock.calls[0]![0].since!);
    expect(since).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(since).toBeLessThanOrEqual(Date.now() - 24 * 60 * 60 * 1000 + 1000);
  });

  test('summaryにはsummary metadataを付け、tagged itemを全て消してsummary自体は消さない', async () => {
    const slack = setupSlack({
      historyPages: [[tagged('300.0', { number: 2 }), tagged('200.0', { number: 1 }), summaryMessage('100.0')]],
    });
    setupGitHub({});

    await runSummary(CHANNEL, REPO, NO_FILTERS);

    expect(slack.post.mock.calls[0]![0].metadata).toEqual({
      event_type: SUMMARY_EVENT_TYPE,
      event_payload: { repo: REPO },
    });
    expect(slack.del.mock.calls.map(([args]) => (args as { ts: string }).ts)).toEqual(['300.0', '200.0']);
  });

  test('他bot・他repo・metadataなしのメッセージは集計も削除もしない', async () => {
    const slack = setupSlack({
      historyPages: [[
        tagged('300.0', { number: 1 }, { bot_id: 'B_OTHER' }),
        tagged('200.0', { number: 2, repo: 'owner/other' }),
        { ts: '100.0', bot_id: BOT_ID, text: 'Daily Summary' },
      ]],
    });
    setupGitHub({});

    await runSummary(CHANNEL, REPO, NO_FILTERS);

    expect(postedText(slack)).toContain('No activity today');
    expect(slack.del).not.toHaveBeenCalled();
  });

  test('message_not_foundでも残りの削除を続ける', async () => {
    const slack = setupSlack({
      historyPages: [[tagged('200.0', { number: 2 }), tagged('100.0', { number: 1 })]],
      deleteError: (ts) => (ts === '200.0' ? messageNotFound : null),
    });
    setupGitHub({});

    await runSummary(CHANNEL, REPO, NO_FILTERS);

    expect(slack.del).toHaveBeenCalledTimes(2);
  });
});
