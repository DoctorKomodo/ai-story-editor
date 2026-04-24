import crypto from 'node:crypto';

export const AES_KEY_BYTES = 32;
export const AES_IV_BYTES = 12;
export const AES_AUTH_TAG_BYTES = 16;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoConfigError';
  }
}

export class CryptoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoInputError';
  }
}

let cachedKey: Buffer | null = null;

function loadAppEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    throw new CryptoConfigError(
      'APP_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'base64\'))"',
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new CryptoConfigError('APP_ENCRYPTION_KEY must be valid base64');
  }

  if (decoded.length !== AES_KEY_BYTES) {
    throw new CryptoConfigError(
      `APP_ENCRYPTION_KEY must decode to ${AES_KEY_BYTES} bytes; got ${decoded.length}`,
    );
  }

  cachedKey = decoded;
  return decoded;
}

// Exposed for tests that override APP_ENCRYPTION_KEY after import; no caller
// in production should flush the cache.
export function _resetAppEncryptionKeyCache(): void {
  cachedKey = null;
}

function toBuffer(plaintext: unknown): Buffer {
  if (typeof plaintext === 'string') return Buffer.from(plaintext, 'utf8');
  if (Buffer.isBuffer(plaintext)) return plaintext;
  throw new CryptoInputError('encrypt() expects a string or Buffer');
}

export function encrypt(plaintext: string | Buffer): EncryptedPayload {
  const key = loadAppEncryptionKey();
  const iv = crypto.randomBytes(AES_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(toBuffer(plaintext)), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function parseBase64Field(
  value: unknown,
  field: string,
  { expectedLength, allowEmpty }: { expectedLength?: number; allowEmpty?: boolean } = {},
): Buffer {
  if (typeof value !== 'string') {
    throw new CryptoInputError(`decrypt() ${field} must be a string`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new CryptoInputError(`decrypt() missing ${field}`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(value, 'base64');
  } catch {
    throw new CryptoInputError(`decrypt() ${field} is not valid base64`);
  }
  if (expectedLength !== undefined && buf.length !== expectedLength) {
    throw new CryptoInputError(
      `decrypt() ${field} must be ${expectedLength} bytes; got ${buf.length}`,
    );
  }
  return buf;
}

export function decrypt(payload: EncryptedPayload): string {
  const key = loadAppEncryptionKey();
  const iv = parseBase64Field(payload.iv, 'iv', { expectedLength: AES_IV_BYTES });
  const authTag = parseBase64Field(payload.authTag, 'authTag', {
    expectedLength: AES_AUTH_TAG_BYTES,
  });
  // GCM of an empty plaintext produces an empty ciphertext + a 16-byte auth tag.
  // Allow an empty base64 string here so round-tripping "" is lossless.
  const ciphertext = parseBase64Field(payload.ciphertext, 'ciphertext', { allowEmpty: true });

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  // GCM's decipher.final() throws if the auth tag doesn't validate — any
  // tampering with ciphertext or authTag surfaces as a thrown Error.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function constantTimeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ba = typeof a === 'string' ? Buffer.from(a, 'utf8') : a;
  const bb = typeof b === 'string' ? Buffer.from(b, 'utf8') : b;
  if (ba.length !== bb.length) {
    // timingSafeEqual throws on length mismatch; spend a constant-time compare
    // against a dummy buffer so the wrong-length case doesn't leak length info
    // via wall-clock.
    const dummy = Buffer.alloc(ba.length);
    crypto.timingSafeEqual(ba, dummy);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}
