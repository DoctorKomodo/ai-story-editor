import * as argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet 2024 baseline for argon2id:
//   memoryCost  m = 19,456 KiB  (≈19 MiB)
//   timeCost    t = 2
//   parallelism p = 1
//   type        argon2id
// The same parameters are reused for DEK-wrap key derivation in [E3] so a
// single config lives here (imported by content-crypto.service when that lands).
export const ARGON2_PARAMS: argon2.Options = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
}) as argon2.Options;

// Salt length used for DEK-wrap key derivation ([E3]). argon2.hash() supplies
// its own salt when hashing passwords; this constant is for the wrap-key path
// that calls argon2.hash(..., { raw: true, salt: …, hashLength: 32 }).
export const DEK_WRAP_SALT_BYTES = 16;
