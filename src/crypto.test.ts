import { describe, expect, test, afterEach } from 'bun:test';
import {
  getEncryptionKey,
  isEncryptionEnabled,
  isDebugMode,
  encryptEntry,
  decryptEntry,
  isEncrypted,
} from './crypto.js';
import type { PullRequestEntry } from './types.js';

describe('crypto', () => {
  const TEST_KEY_BASE64 = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE='; // 32 bytes
  const TEST_KEY = Buffer.from(TEST_KEY_BASE64, 'base64');

  describe('isDebugMode', () => {
    const originalDebugMode = process.env.INPUT_DEBUG_MODE;

    afterEach(() => {
      if (originalDebugMode !== undefined) {
        process.env.INPUT_DEBUG_MODE = originalDebugMode;
      } else {
        delete process.env.INPUT_DEBUG_MODE;
      }
    });

    test('INPUT_DEBUG_MODE=trueの場合はtrueを返す', () => {
      process.env.INPUT_DEBUG_MODE = 'true';
      expect(isDebugMode()).toBe(true);
    });

    test('INPUT_DEBUG_MODEが未設定の場合はfalseを返す', () => {
      delete process.env.INPUT_DEBUG_MODE;
      expect(isDebugMode()).toBe(false);
    });

    test('INPUT_DEBUG_MODE=falseの場合はfalseを返す', () => {
      process.env.INPUT_DEBUG_MODE = 'false';
      expect(isDebugMode()).toBe(false);
    });
  });

  describe('getEncryptionKey', () => {
    const originalEncryptionKey = process.env.INPUT_ENCRYPTION_KEY;
    const originalDebugMode = process.env.INPUT_DEBUG_MODE;

    afterEach(() => {
      if (originalEncryptionKey !== undefined) {
        process.env.INPUT_ENCRYPTION_KEY = originalEncryptionKey;
      } else {
        delete process.env.INPUT_ENCRYPTION_KEY;
      }
      if (originalDebugMode !== undefined) {
        process.env.INPUT_DEBUG_MODE = originalDebugMode;
      } else {
        delete process.env.INPUT_DEBUG_MODE;
      }
    });

    test('ENCRYPTION_KEYが設定されていない場合はエラーを投げる', () => {
      delete process.env.INPUT_ENCRYPTION_KEY;
      delete process.env.INPUT_DEBUG_MODE;
      expect(() => getEncryptionKey()).toThrow('encryption_key input is required');
    });

    test('デバッグモードではENCRYPTION_KEYがなくてもエラーにならない', () => {
      delete process.env.INPUT_ENCRYPTION_KEY;
      process.env.INPUT_DEBUG_MODE = 'true';
      const key = getEncryptionKey();
      expect(key.length).toBe(32);
    });

    test('32バイトのキーを返す', () => {
      process.env.INPUT_ENCRYPTION_KEY = TEST_KEY_BASE64;
      delete process.env.INPUT_DEBUG_MODE;
      const key = getEncryptionKey();
      expect(key.length).toBe(32);
    });

    test('不正なキー長でエラーを投げる', () => {
      process.env.INPUT_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
      delete process.env.INPUT_DEBUG_MODE;
      expect(() => getEncryptionKey()).toThrow('must be 32 bytes');
    });
  });

  describe('isEncryptionEnabled', () => {
    const originalDebugMode = process.env.INPUT_DEBUG_MODE;

    afterEach(() => {
      if (originalDebugMode !== undefined) {
        process.env.INPUT_DEBUG_MODE = originalDebugMode;
      } else {
        delete process.env.INPUT_DEBUG_MODE;
      }
    });

    test('デバッグモードでない場合はtrueを返す', () => {
      delete process.env.INPUT_DEBUG_MODE;
      expect(isEncryptionEnabled()).toBe(true);
    });

    test('デバッグモードの場合はfalseを返す', () => {
      process.env.INPUT_DEBUG_MODE = 'true';
      expect(isEncryptionEnabled()).toBe(false);
    });
  });

  describe('encryptEntry / decryptEntry', () => {
    test('オブジェクトを暗号化・復号できる', () => {
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

      const encrypted = encryptEntry(entry, TEST_KEY);
      expect(encrypted.startsWith('enc:')).toBe(true);

      const decrypted = decryptEntry<PullRequestEntry>(encrypted, TEST_KEY);
      expect(decrypted).toEqual(entry);
    });

    test('毎回異なる暗号文を生成する（IV がランダム）', () => {
      const entry = { test: 'value' };

      const encrypted1 = encryptEntry(entry, TEST_KEY);
      const encrypted2 = encryptEntry(entry, TEST_KEY);

      expect(encrypted1).not.toBe(encrypted2);
    });

    test('日本語を含むデータを正しく暗号化・復号できる', () => {
      const entry = {
        title: 'これはテストです 🚀',
        author: '田中太郎',
      };

      const encrypted = encryptEntry(entry, TEST_KEY);
      const decrypted = decryptEntry<typeof entry>(encrypted, TEST_KEY);

      expect(decrypted).toEqual(entry);
    });

    test('不正なキーで復号に失敗する', () => {
      const entry = { test: 'value' };
      const wrongKey = Buffer.alloc(32, 'x');

      const encrypted = encryptEntry(entry, TEST_KEY);

      expect(() => decryptEntry(encrypted, wrongKey)).toThrow();
    });

    test('暗号化されていないデータでエラーを投げる', () => {
      const plainJson = JSON.stringify({ test: 'value' });
      expect(() => decryptEntry(plainJson, TEST_KEY)).toThrow('missing encryption prefix');
    });
  });

  describe('isEncrypted', () => {
    test('暗号化された文字列でtrueを返す', () => {
      const entry = { test: 'value' };
      const encrypted = encryptEntry(entry, TEST_KEY);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    test('通常の文字列でfalseを返す', () => {
      expect(isEncrypted('normal string')).toBe(false);
      expect(isEncrypted('{"json": "object"}')).toBe(false);
    });
  });
});
