import { describe, expect, test } from 'bun:test';
import { shouldNotifyByLabels } from './github.js';

describe('shouldNotifyByLabels', () => {
  describe('フィルターが未設定の場合', () => {
    test('filterModeが空の場合は常にtrueを返す', () => {
      expect(shouldNotifyByLabels(['bug', 'feature'], '', ['bug'])).toBe(true);
    });

    test('filterLabelsが空配列の場合は常にtrueを返す', () => {
      expect(shouldNotifyByLabels(['bug', 'feature'], 'whitelist', [])).toBe(true);
    });

    test('両方未設定の場合も常にtrueを返す', () => {
      expect(shouldNotifyByLabels(['bug'], '', [])).toBe(true);
    });
  });

  describe('whitelistモードの場合', () => {
    test('マッチするラベルがあればtrueを返す', () => {
      expect(shouldNotifyByLabels(['bug', 'feature'], 'whitelist', ['bug'])).toBe(true);
    });

    test('マッチするラベルがなければfalseを返す', () => {
      expect(shouldNotifyByLabels(['documentation'], 'whitelist', ['bug', 'feature'])).toBe(false);
    });

    test('大文字小文字を区別しない', () => {
      expect(shouldNotifyByLabels(['BUG'], 'whitelist', ['bug'])).toBe(true);
      expect(shouldNotifyByLabels(['bug'], 'whitelist', ['BUG'])).toBe(true);
    });

    test('空のラベル配列の場合はfalseを返す', () => {
      expect(shouldNotifyByLabels([], 'whitelist', ['bug'])).toBe(false);
    });
  });

  describe('blacklistモードの場合', () => {
    test('マッチするラベルがあればfalseを返す', () => {
      expect(shouldNotifyByLabels(['bug', 'feature'], 'blacklist', ['bug'])).toBe(false);
    });

    test('マッチするラベルがなければtrueを返す', () => {
      expect(shouldNotifyByLabels(['documentation'], 'blacklist', ['bug', 'feature'])).toBe(true);
    });

    test('大文字小文字を区別しない', () => {
      expect(shouldNotifyByLabels(['BUG'], 'blacklist', ['bug'])).toBe(false);
      expect(shouldNotifyByLabels(['bug'], 'blacklist', ['BUG'])).toBe(false);
    });

    test('空のラベル配列の場合はtrueを返す', () => {
      expect(shouldNotifyByLabels([], 'blacklist', ['bug'])).toBe(true);
    });
  });
});
