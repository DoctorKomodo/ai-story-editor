import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AES_AUTH_TAG_BYTES,
  AES_IV_BYTES,
  AES_KEY_BYTES,
  CryptoConfigError,
  CryptoInputError,
  _resetAppEncryptionKeyCache,
  constantTimeEqual,
  decrypt,
  encrypt,
  type EncryptedPayload,
} from '../../src/services/crypto.service';
import '../setup';

describe('crypto.service — AES-256-GCM helper ([AU11])', () => {
  beforeEach(() => {
    _resetAppEncryptionKeyCache();
  });

  afterEach(() => {
    _resetAppEncryptionKeyCache();
  });

  describe('key validation', () => {
    it('throws CryptoConfigError when APP_ENCRYPTION_KEY is unset', () => {
      const prev = process.env.APP_ENCRYPTION_KEY;
      delete process.env.APP_ENCRYPTION_KEY;
      try {
        expect(() => encrypt('hello')).toThrow(CryptoConfigError);
      } finally {
        process.env.APP_ENCRYPTION_KEY = prev;
      }
    });

    it('throws CryptoConfigError when APP_ENCRYPTION_KEY decodes to the wrong length', () => {
      const prev = process.env.APP_ENCRYPTION_KEY;
      process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16, 0xcd).toString('base64');
      try {
        expect(() => encrypt('hello')).toThrow(CryptoConfigError);
      } finally {
        process.env.APP_ENCRYPTION_KEY = prev;
      }
    });

    it('accepts a 32-byte base64 key', () => {
      const prev = process.env.APP_ENCRYPTION_KEY;
      process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(AES_KEY_BYTES).toString('base64');
      try {
        expect(() => encrypt('hello')).not.toThrow();
      } finally {
        process.env.APP_ENCRYPTION_KEY = prev;
      }
    });
  });

  describe('encrypt() / decrypt()', () => {
    it('roundtrips a plain string', () => {
      const payload = encrypt('hello world');
      expect(decrypt(payload)).toBe('hello world');
    });

    it('produces base64 fields at the expected lengths (IV=12, authTag=16)', () => {
      const payload = encrypt('hello world');
      const iv = Buffer.from(payload.iv, 'base64');
      const authTag = Buffer.from(payload.authTag, 'base64');
      expect(iv.length).toBe(AES_IV_BYTES);
      expect(authTag.length).toBe(AES_AUTH_TAG_BYTES);
      // All fields are valid base64 (decodes to non-empty buffer).
      expect(Buffer.from(payload.ciphertext, 'base64').length).toBeGreaterThan(0);
    });

    it('yields distinct ciphertext + iv on repeat encrypt of the same plaintext', () => {
      const a = encrypt('same string');
      const b = encrypt('same string');
      expect(a.ciphertext).not.toBe(b.ciphertext);
      expect(a.iv).not.toBe(b.iv);
      expect(decrypt(a)).toBe('same string');
      expect(decrypt(b)).toBe('same string');
    });

    it('roundtrips a Unicode string losslessly', () => {
      const s = 'café — 史 — 🐙 — ünicode';
      expect(decrypt(encrypt(s))).toBe(s);
    });

    it('roundtrips a Buffer input', () => {
      const s = Buffer.from('binary data — %ff%00%7f', 'utf8');
      expect(decrypt(encrypt(s))).toBe(s.toString('utf8'));
    });

    it('roundtrips the empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });

    it('throws when the auth tag is tampered with', () => {
      const payload = encrypt('do not tamper');
      const tamperedTag = Buffer.from(payload.authTag, 'base64');
      tamperedTag[0] ^= 0x01;
      const bad: EncryptedPayload = { ...payload, authTag: tamperedTag.toString('base64') };

      expect(() => decrypt(bad)).toThrow();
    });

    it('throws when the ciphertext is tampered with', () => {
      const payload = encrypt('do not tamper');
      const ct = Buffer.from(payload.ciphertext, 'base64');
      ct[0] ^= 0x01;
      const bad: EncryptedPayload = { ...payload, ciphertext: ct.toString('base64') };

      expect(() => decrypt(bad)).toThrow();
    });

    it('throws when the IV is tampered with', () => {
      const payload = encrypt('do not tamper');
      const iv = Buffer.from(payload.iv, 'base64');
      iv[0] ^= 0x01;
      const bad: EncryptedPayload = { ...payload, iv: iv.toString('base64') };

      expect(() => decrypt(bad)).toThrow();
    });

    it('throws CryptoInputError on missing iv / authTag (ciphertext may legally be empty)', () => {
      const payload = encrypt('x');
      expect(() => decrypt({ ...payload, iv: '' })).toThrow(CryptoInputError);
      expect(() => decrypt({ ...payload, authTag: '' })).toThrow(CryptoInputError);
    });

    it('throws CryptoInputError on wrong IV length', () => {
      const payload = encrypt('x');
      const shortIv = Buffer.alloc(8).toString('base64');
      expect(() => decrypt({ ...payload, iv: shortIv })).toThrow(CryptoInputError);
    });

    it('throws CryptoInputError on wrong authTag length', () => {
      const payload = encrypt('x');
      const shortTag = Buffer.alloc(8).toString('base64');
      expect(() => decrypt({ ...payload, authTag: shortTag })).toThrow(CryptoInputError);
    });

    it('fails to decrypt when the key has rotated (no decrypt under a different APP_ENCRYPTION_KEY)', () => {
      const payload = encrypt('locked in');

      const prev = process.env.APP_ENCRYPTION_KEY;
      process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(AES_KEY_BYTES).toString('base64');
      _resetAppEncryptionKeyCache();
      try {
        expect(() => decrypt(payload)).toThrow();
      } finally {
        process.env.APP_ENCRYPTION_KEY = prev;
        _resetAppEncryptionKeyCache();
      }
    });
  });

  describe('constantTimeEqual()', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    });

    it('returns false for different same-length strings', () => {
      expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
    });

    it('returns false for different-length strings', () => {
      expect(constantTimeEqual('abc', 'abcdef')).toBe(false);
    });

    it('accepts Buffer inputs', () => {
      expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
      expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    });
  });
});
