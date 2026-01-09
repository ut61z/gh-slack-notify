import { describe, expect, test, beforeEach } from 'bun:test';
import {
  addPREntry,
  getPREntry,
  updatePREntry,
  addIssueEntry,
  getIssueEntry,
  updateIssueEntry,
  clearEntries,
  updateLastSummaryAt,
} from './state.js';
import type { NotificationState, PullRequestEntry, IssueEntry } from './types.js';

describe('PR Entry 操作', () => {
  let state: NotificationState;

  beforeEach(() => {
    state = {
      pull_requests: {},
      issues: {},
    };
  });

  describe('addPREntry', () => {
    test('新しいPRエントリを追加できる', () => {
      const entry: PullRequestEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/1',
        repo: 'repo',
        author: 'testuser',
      };

      addPREntry(state, '1', entry);

      expect(state.pull_requests['1']).toEqual(entry);
    });

    test('既存のエントリを上書きできる', () => {
      const entry1: PullRequestEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/1',
        repo: 'repo',
        author: 'testuser',
      };

      const entry2: PullRequestEntry = {
        ...entry1,
        event: 'merged',
      };

      addPREntry(state, '1', entry1);
      addPREntry(state, '1', entry2);

      expect(state.pull_requests['1'].event).toBe('merged');
    });
  });

  describe('getPREntry', () => {
    test('存在するエントリを取得できる', () => {
      const entry: PullRequestEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/1',
        repo: 'repo',
        author: 'testuser',
      };

      state.pull_requests['1'] = entry;

      expect(getPREntry(state, '1')).toEqual(entry);
    });

    test('存在しないエントリはundefinedを返す', () => {
      expect(getPREntry(state, '999')).toBeUndefined();
    });
  });

  describe('updatePREntry', () => {
    test('既存のエントリを部分更新できる', () => {
      const entry: PullRequestEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/1',
        repo: 'repo',
        author: 'testuser',
      };

      state.pull_requests['1'] = entry;
      updatePREntry(state, '1', { event: 'merged', reply_message_ts: '1234567890.999999' });

      expect(state.pull_requests['1'].event).toBe('merged');
      expect(state.pull_requests['1'].reply_message_ts).toBe('1234567890.999999');
      expect(state.pull_requests['1'].title).toBe('Test PR'); // 変更されていない
    });

    test('存在しないエントリの更新は何もしない', () => {
      updatePREntry(state, '999', { event: 'merged' });

      expect(state.pull_requests['999']).toBeUndefined();
    });
  });
});

describe('Issue Entry 操作', () => {
  let state: NotificationState;

  beforeEach(() => {
    state = {
      pull_requests: {},
      issues: {},
    };
  });

  describe('addIssueEntry', () => {
    test('新しいIssueエントリを追加できる', () => {
      const entry: IssueEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/1',
        repo: 'repo',
        author: 'testuser',
      };

      addIssueEntry(state, '1', entry);

      expect(state.issues['1']).toEqual(entry);
    });
  });

  describe('getIssueEntry', () => {
    test('存在するエントリを取得できる', () => {
      const entry: IssueEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/1',
        repo: 'repo',
        author: 'testuser',
      };

      state.issues['1'] = entry;

      expect(getIssueEntry(state, '1')).toEqual(entry);
    });

    test('存在しないエントリはundefinedを返す', () => {
      expect(getIssueEntry(state, '999')).toBeUndefined();
    });
  });

  describe('updateIssueEntry', () => {
    test('既存のエントリを部分更新できる', () => {
      const entry: IssueEntry = {
        channel: 'C123',
        message_ts: '1234567890.123456',
        created_at: '2024-01-01T00:00:00Z',
        event: 'opened',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/1',
        repo: 'repo',
        author: 'testuser',
      };

      state.issues['1'] = entry;
      updateIssueEntry(state, '1', { event: 'closed', reply_message_ts: '1234567890.999999' });

      expect(state.issues['1'].event).toBe('closed');
      expect(state.issues['1'].reply_message_ts).toBe('1234567890.999999');
      expect(state.issues['1'].title).toBe('Test Issue'); // 変更されていない
    });

    test('存在しないエントリの更新は何もしない', () => {
      updateIssueEntry(state, '999', { event: 'closed' });

      expect(state.issues['999']).toBeUndefined();
    });
  });
});

describe('clearEntries', () => {
  test('PRとIssueのエントリをクリアする', () => {
    const state: NotificationState = {
      last_summary_at: '2024-01-01T00:00:00Z',
      pull_requests: {
        '1': {
          channel: 'C123',
          message_ts: '1234567890.123456',
          created_at: '2024-01-01T00:00:00Z',
          event: 'opened',
          title: 'Test PR',
          url: 'https://github.com/owner/repo/pull/1',
          repo: 'repo',
          author: 'testuser',
        },
      },
      issues: {
        '1': {
          channel: 'C123',
          message_ts: '1234567890.123456',
          created_at: '2024-01-01T00:00:00Z',
          event: 'opened',
          title: 'Test Issue',
          url: 'https://github.com/owner/repo/issues/1',
          repo: 'repo',
          author: 'testuser',
        },
      },
    };

    clearEntries(state);

    expect(state.pull_requests).toEqual({});
    expect(state.issues).toEqual({});
    expect(state.last_summary_at).toBe('2024-01-01T00:00:00Z'); // 変更されていない
  });
});

describe('updateLastSummaryAt', () => {
  test('last_summary_at を現在時刻に更新する', () => {
    const state: NotificationState = {
      pull_requests: {},
      issues: {},
    };

    const before = new Date().toISOString();
    updateLastSummaryAt(state);
    const after = new Date().toISOString();

    expect(state.last_summary_at).toBeDefined();
    expect(state.last_summary_at! >= before).toBe(true);
    expect(state.last_summary_at! <= after).toBe(true);
  });
});
