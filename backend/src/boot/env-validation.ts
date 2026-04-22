// Boot-time environment validation for encryption-related env vars.
//
// Invariants asserted here (and in tests/boot/encryption-keys.test.ts):
//   - APP_ENCRYPTION_KEY is set and decodes to exactly 32 bytes of base64.
//     It wraps stored BYOK Venice API keys only (see [AU11] / docs/encryption.md).
//   - No CONTENT_ENCRYPTION_KEY requirement exists. The envelope scheme derives
//     content DEKs from user credentials; see docs/encryption.md. If the var is
//     present in the environment we warn so a stale .env doesn't silently lead
//     users to believe it's doing anything.

export const APP_ENCRYPTION_KEY_BYTES = 32;

export class BootValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootValidationError';
  }
}

const GENERATE_HINT =
  'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"';

export interface ValidateOptions {
  env?: NodeJS.ProcessEnv;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn?: (message: string) => void;
}

export function validateEncryptionEnv(opts: ValidateOptions = {}): void {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((m) => console.warn(m));

  const raw = env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length === 0) {
    throw new BootValidationError(
      `APP_ENCRYPTION_KEY is not set. Generate one with:\n  ${GENERATE_HINT}\n` +
        'Add the output to your .env. This key wraps stored Venice API keys ' +
        '(see docs/encryption.md).',
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new BootValidationError(
      `APP_ENCRYPTION_KEY must be valid base64. Regenerate with:\n  ${GENERATE_HINT}`,
    );
  }

  if (decoded.length !== APP_ENCRYPTION_KEY_BYTES) {
    throw new BootValidationError(
      `APP_ENCRYPTION_KEY must decode to ${APP_ENCRYPTION_KEY_BYTES} bytes; ` +
        `got ${decoded.length}. Regenerate with:\n  ${GENERATE_HINT}`,
    );
  }

  if (env.CONTENT_ENCRYPTION_KEY) {
    warn(
      '[boot] CONTENT_ENCRYPTION_KEY is set but unused. The envelope scheme ' +
        'derives content DEKs from user credentials (docs/encryption.md). ' +
        'Remove it from your .env to avoid confusion.',
    );
  }
}
