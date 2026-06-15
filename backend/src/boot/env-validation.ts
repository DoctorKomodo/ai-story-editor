// Boot-time environment check. There is no longer a required encryption env
// secret: the BYOK Venice key is wrapped by the per-user content DEK, and
// narrative content by user-credential-derived wraps (see docs/encryption.md).
// We only warn if a now-unused key lingers in a stale .env.

export interface ValidateOptions {
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

export function validateEncryptionEnv(opts: ValidateOptions = {}): void {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((m) => console.warn(m));

  if (env.APP_ENCRYPTION_KEY) {
    warn(
      '[boot] APP_ENCRYPTION_KEY is set but no longer used. The BYOK Venice key ' +
        'is now wrapped by the per-user content DEK (docs/encryption.md). ' +
        'Remove it from your .env.',
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
