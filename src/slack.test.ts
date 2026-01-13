import { describe, expect, test } from 'bun:test';
import { buildPRBlocks, buildIssueBlocks, buildWorkflowBlocks } from './slack.js';
import type { SectionBlock, ContextBlock } from '@slack/web-api';

describe('buildPRBlocks', () => {
  const baseParams = {
    title: 'Add new feature',
    url: 'https://github.com/owner/repo/pull/42',
    number: 42,
    repo: 'my-repo',
    author: 'testuser',
  };

  describe('opened アクション', () => {
    test('基本的なブロック構造を返す', () => {
      const blocks = buildPRBlocks({ ...baseParams, action: 'opened' });

      expect(blocks).toHaveLength(3);
      expect(blocks[0]!.type).toBe('section');
      expect((blocks[0] as SectionBlock).text?.text).toContain(':trident:');
      expect((blocks[0] as SectionBlock).text?.text).toContain('opened');
    });

    test('PRリンクが含まれる', () => {
      const blocks = buildPRBlocks({ ...baseParams, action: 'opened' });

      expect((blocks[1] as SectionBlock).text?.text).toContain(
        '<https://github.com/owner/repo/pull/42|#42: Add new feature>'
      );
    });

    test('コンテキスト情報が含まれる', () => {
      const blocks = buildPRBlocks({ ...baseParams, action: 'opened' });
      const contextBlock = blocks[2] as ContextBlock;

      expect(contextBlock.elements[0]).toHaveProperty('text');
      expect((contextBlock.elements[0] as { text: string }).text).toContain('my-repo');
      expect((contextBlock.elements[0] as { text: string }).text).toContain('testuser');
    });

    test('bodyがある場合は4つ目のブロックに含まれる', () => {
      const blocks = buildPRBlocks({
        ...baseParams,
        action: 'opened',
        body: 'This is the PR body',
      });

      expect(blocks).toHaveLength(4);
      expect((blocks[3] as SectionBlock).text?.text).toBe('This is the PR body');
    });

    test('bodyが200文字を超える場合は切り詰められる', () => {
      const longBody = 'a'.repeat(250);
      const blocks = buildPRBlocks({
        ...baseParams,
        action: 'opened',
        body: longBody,
      });

      const bodyText = (blocks[3] as SectionBlock).text?.text;
      expect(bodyText).toHaveLength(203); // 200 + '...'
      expect(bodyText).toEndWith('...');
    });
  });

  describe('merged アクション', () => {
    test('マージ時のemoji とテキストを返す', () => {
      const blocks = buildPRBlocks({ ...baseParams, action: 'merged' });

      expect(blocks).toHaveLength(3);
      expect((blocks[0] as SectionBlock).text?.text).toContain(':feet:');
      expect((blocks[0] as SectionBlock).text?.text).toContain('merged');
    });

    test('bodyがあっても追加されない', () => {
      const blocks = buildPRBlocks({
        ...baseParams,
        action: 'merged',
        body: 'This should not appear',
      });

      expect(blocks).toHaveLength(3);
    });
  });

  describe('closed アクション', () => {
    test('クローズ時のemojiとテキストを返す', () => {
      const blocks = buildPRBlocks({ ...baseParams, action: 'closed' });

      expect(blocks).toHaveLength(3);
      expect((blocks[0] as SectionBlock).text?.text).toContain(':ballot_box_with_check:');
      expect((blocks[0] as SectionBlock).text?.text).toContain('closed');
    });
  });
});

describe('buildIssueBlocks', () => {
  const baseParams = {
    title: 'Bug report',
    url: 'https://github.com/owner/repo/issues/123',
    number: 123,
    repo: 'my-repo',
    author: 'reporter',
  };

  describe('opened アクション', () => {
    test('基本的なブロック構造を返す', () => {
      const blocks = buildIssueBlocks({ ...baseParams, action: 'opened' });

      expect(blocks).toHaveLength(3);
      expect((blocks[0] as SectionBlock).text?.text).toContain(':raised_hand:');
      expect((blocks[0] as SectionBlock).text?.text).toContain('opened');
    });

    test('Issueリンクが含まれる', () => {
      const blocks = buildIssueBlocks({ ...baseParams, action: 'opened' });

      expect((blocks[1] as SectionBlock).text?.text).toContain(
        '<https://github.com/owner/repo/issues/123|#123: Bug report>'
      );
    });

    test('bodyがある場合は4つ目のブロックに含まれる', () => {
      const blocks = buildIssueBlocks({
        ...baseParams,
        action: 'opened',
        body: 'Issue description',
      });

      expect(blocks).toHaveLength(4);
      expect((blocks[3] as SectionBlock).text?.text).toBe('Issue description');
    });
  });

  describe('closed アクション', () => {
    test('クローズ時のemojiとテキストを返す', () => {
      const blocks = buildIssueBlocks({ ...baseParams, action: 'closed' });

      expect(blocks).toHaveLength(3);
      expect((blocks[0] as SectionBlock).text?.text).toContain(':feet:');
      expect((blocks[0] as SectionBlock).text?.text).toContain('closed');
    });

    test('bodyがあっても追加されない', () => {
      const blocks = buildIssueBlocks({
        ...baseParams,
        action: 'closed',
        body: 'This should not appear',
      });

      expect(blocks).toHaveLength(3);
    });
  });
});

describe('buildWorkflowBlocks', () => {
  const baseParams = {
    workflowName: 'CI',
    runUrl: 'https://github.com/owner/repo/actions/runs/123',
    repo: 'my-repo',
    branch: 'main',
  };

  describe('success の場合', () => {
    test('成功時のブロックを返す', () => {
      const blocks = buildWorkflowBlocks({ ...baseParams, conclusion: 'success' });

      expect(blocks).toHaveLength(3);
      expect((blocks[0] as SectionBlock).text?.text).toContain('✅');
      expect((blocks[0] as SectionBlock).text?.text).toContain('succeeded');
    });

    test('ワークフロー名とリンクが含まれる', () => {
      const blocks = buildWorkflowBlocks({ ...baseParams, conclusion: 'success' });

      expect((blocks[1] as SectionBlock).text?.text).toContain(
        '<https://github.com/owner/repo/actions/runs/123|CI>'
      );
    });

    test('コンテキスト情報が含まれる', () => {
      const blocks = buildWorkflowBlocks({ ...baseParams, conclusion: 'success' });
      const contextBlock = blocks[2] as ContextBlock;

      expect((contextBlock.elements[0] as { text: string }).text).toContain('my-repo');
      expect((contextBlock.elements[0] as { text: string }).text).toContain('main');
    });
  });

  describe('failure の場合', () => {
    test('失敗時のブロックを返す', () => {
      const blocks = buildWorkflowBlocks({ ...baseParams, conclusion: 'failure' });

      expect((blocks[0] as SectionBlock).text?.text).toContain('❌');
      expect((blocks[0] as SectionBlock).text?.text).toContain('failed');
    });
  });

  describe('duration オプション', () => {
    test('durationがある場合は表示される', () => {
      const blocks = buildWorkflowBlocks({
        ...baseParams,
        conclusion: 'success',
        duration: 120,
      });
      const contextBlock = blocks[2] as ContextBlock;

      expect((contextBlock.elements[0] as { text: string }).text).toContain('⏱️ 120s');
    });

    test('durationがない場合は表示されない', () => {
      const blocks = buildWorkflowBlocks({ ...baseParams, conclusion: 'success' });
      const contextBlock = blocks[2] as ContextBlock;

      expect((contextBlock.elements[0] as { text: string }).text).not.toContain('⏱️');
    });
  });
});
