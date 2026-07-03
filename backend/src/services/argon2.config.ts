import * as argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet 2024 baseline for argon2id:
//   memoryCost  m = 19,456 KiB  (≈19 MiB)
//   timeCost    t = 2
//   parallelism p = 1
//   type        argon2id
// The same parameters are reused for DEK-wrap key derivation in [E3] so a
// single config lives here (imported by content-crypto.service when that lands).
export const ARGON2_PARAMS_PRODUCTION: argon2.Options = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
}) as argon2.Options;

// Deliberately weak parameters for the test suite ONLY — the suite pays
// thousands of derivations per run and the KDF cost is not what any test
// asserts. type + parallelism match production so encoded hash strings stay
// format-compatible ($argon2id$…p=1$). Floors verified against the installed
// node-argon2 (0.44.0) vendored reference C: ARGON2_MIN_TIME = 1,
// ARGON2_MIN_MEMORY = 8 KiB.
export const ARGON2_PARAMS_TEST: argon2.Options = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 8_192,
  timeCost: 1,
  parallelism: 1,
}) as argon2.Options;

// Double-gated: NODE_ENV must be 'test' AND TEST_FAST_ARGON2=1 must be an
// explicit opt-in (set by backend/vitest.config.ts `test.env`). The boot
// validator (boot/env-validation.ts) refuses to start if TEST_FAST_ARGON2
// reaches a production environment.
export const ARGON2_PARAMS: argon2.Options =
  process.env.NODE_ENV === 'test' && process.env.TEST_FAST_ARGON2 === '1'
    ? ARGON2_PARAMS_TEST
    : ARGON2_PARAMS_PRODUCTION;

// Salt length used for DEK-wrap key derivation ([E3]). argon2.hash() supplies
// its own salt when hashing passwords; this constant is for the wrap-key path
// that calls argon2.hash(..., { raw: true, salt: …, hashLength: 32 }).
export const DEK_WRAP_SALT_BYTES = 16;
