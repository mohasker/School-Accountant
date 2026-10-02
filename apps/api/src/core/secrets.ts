import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fail } from '../common/validation';

/**
 * Encryption of secrets kept in the database (OneDrive client secret and refresh token, assistant key).
 * AES-256-GCM with a key derived from SECRETS_KEY. On a local installation without it, a random key
 * is created once in `.data/secrets.key`; a production server must set SECRETS_KEY, because its
 * container storage is not permanent and the stored secrets would become unreadable.
 */
const PREFIX = 'enc:v1:';
let key: Buffer | undefined;

function secretKey() {
  if (key) return key;
  const env = process.env.SECRETS_KEY;
  if (env) {
    if (env.length < 16) fail('SECRETS_KEY قصير؛ استخدم 16 حرفاً على الأقل');
    return (key = createHash('sha256').update(env).digest());
  }
  if (process.env.NODE_ENV === 'production') fail('SECRETS_KEY غير مضبوط على الخادم؛ أضفه إلى ملف .env ثم أعد التشغيل');
  const file = path.resolve(process.env.SECRETS_KEY_FILE || '.data/secrets.key');
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return (key = createHash('sha256').update(readFileSync(file, 'utf8').trim()).digest());
}

/** Text → `enc:v1:iv.tag.data` (empty stays empty). */
export function seal(value: string) {
  if (!value) return '';
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', secretKey(), iv),
    data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

/** Reverses `seal`; a value saved before encryption existed (no prefix) is returned as it is. */
export function unseal(value: string) {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, data] = value
      .slice(PREFIX.length)
      .split('.')
      .map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    fail('تعذر فك تشفير السر المحفوظ (تغيّر SECRETS_KEY)؛ أعد إدخاله من الإعدادات');
  }
}
