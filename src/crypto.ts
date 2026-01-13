import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:';

// デバッグモードかどうか
export function isDebugMode(): boolean {
  return process.env.DEBUG_MODE === 'true';
}

// 環境変数から暗号化キーを取得（デバッグモードでなければ必須）
export function getEncryptionKey(): Buffer {
  if (isDebugMode()) {
    // デバッグモードではダミーキーを返す（実際には使用されない）
    return Buffer.alloc(32);
  }

  const keyBase64 = process.env.ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error('ENCRYPTION_KEY is required. Set DEBUG_MODE=true to disable encryption for local development.');
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be 32 bytes (256 bits), got ${key.length} bytes`);
  }
  return key;
}

// 暗号化が有効かどうか（デバッグモードでは無効）
export function isEncryptionEnabled(): boolean {
  return !isDebugMode();
}

// オブジェクトを暗号化してbase64文字列に
export function encryptEntry<T>(entry: T, key: Buffer): string {
  const plaintext = JSON.stringify(entry);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // フォーマット: enc:iv:ciphertext:tag (全てbase64)
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

// 暗号文を復号してオブジェクトに
export function decryptEntry<T>(ciphertext: string, key: Buffer): T {
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('Invalid encrypted data: missing encryption prefix');
  }

  const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }

  const [ivBase64, encryptedBase64, tagBase64] = parts as [string, string, string];
  const iv = Buffer.from(ivBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const authTag = Buffer.from(tagBase64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

// 値が暗号化されているかチェック
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}
