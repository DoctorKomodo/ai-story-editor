// [E14] Admin-triggerable recovery-wrap invalidation.
//
// Use case: a user reports their one-time recovery code has leaked (or has
// otherwise lost confidence in it) and cannot reach the UI to rotate it
// themselves via [AU17]. The operator runs this script against the named
// user. It NULLs the four `contentDekRecovery*` columns on `User`, which
// invalidates the current recovery code without touching:
//
//   - the password wrap (user can still log in normally)
//   - the password hash
//   - narrative ciphertext on Story / Chapter / Character / OutlineItem /
//     Chat / Message (nothing the DEK encrypts moves — we only touch a wrap)
//   - sessions / refresh tokens (this is a key-management action, not a
//     session revocation)
//
// After invalidation the user has NO working recovery code. They must log in
// with their password and call POST /api/auth/rotate-recovery-code ([AU17])
// to mint a fresh one. The operator is responsible for communicating that.
//
// This script cannot rotate the recovery wrap directly — that requires the
// user's password to unwrap the DEK, which the admin does not hold by design
// (see docs/encryption.md "No server-held KEK" and the rejected "admin
// decrypt" path). Invalidation is the only safe primitive available server-
// side; the user's next authenticated rotate is what actually issues a new
// code.
//
// Logging discipline: we log exactly the action taken + the username/userId
// we acted on. We NEVER log password hashes, DEK material, recovery-wrap
// column values (old or new), narrative plaintext, or any stack trace that
// might carry those.

import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';

export type ForceRecoveryRotationStatus = 'invalidated' | 'would-invalidate' | 'not-found';

export interface ForceRecoveryRotationResult {
  status: ForceRecoveryRotationStatus;
  userId: string | null;
}

export interface ForceRecoveryRotationOptions {
  dryRun?: boolean;
}

// Match [AU9] register/login normalisation: trim + lowercase. The DB-level
// uniqueness constraint is on the normalised form, so this is the only shape
// a lookup can succeed against.
function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Invalidate the recovery wrap for the named user. Called from the CLI
 * wrapper below and, directly, from the [E14] test suite.
 *
 * Semantics:
 *   - `status: 'invalidated'`      — user found, four recovery columns set to NULL.
 *   - `status: 'would-invalidate'` — dry-run; user found, no write issued.
 *   - `status: 'not-found'`        — no user with that (normalised) username.
 *
 * A wrapped transaction is used so the four NULL writes land together. Even
 * though the update targets a single row, wrapping it keeps the invariant
 * "recovery wrap columns are always all-null or all-populated" explicit and
 * keeps the semantics aligned with [AU17]'s rewrapRecoveryWrap helper.
 */
export async function forceRecoveryRotation(
  client: PrismaClient,
  username: string,
  options: ForceRecoveryRotationOptions = {},
): Promise<ForceRecoveryRotationResult> {
  const normalisedUsername = normaliseUsername(username);
  const user = await client.user.findUnique({
    where: { username: normalisedUsername },
    select: { id: true },
  });

  if (!user) {
    return { status: 'not-found', userId: null };
  }

  if (options.dryRun === true) {
    return { status: 'would-invalidate', userId: user.id };
  }

  await client.$transaction([
    client.user.update({
      where: { id: user.id },
      data: {
        contentDekRecoveryEnc: null,
        contentDekRecoveryIv: null,
        contentDekRecoveryAuthTag: null,
        contentDekRecoverySalt: null,
      },
    }),
  ]);

  return { status: 'invalidated', userId: user.id };
}

// ---------------------------------------------------------------------------
// CLI wrapper
// ---------------------------------------------------------------------------

interface CliArgs {
  username: string;
  dryRun: boolean;
}

function parseCliArgs(argv: string[]): CliArgs | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        username: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });

    const username = values.username;
    if (typeof username !== 'string' || username.length === 0) {
      return { error: 'missing required --username <name>' };
    }

    return {
      username,
      dryRun: values['dry-run'] === true,
    };
  } catch (err) {
    // parseArgs throws on unknown / malformed options. Surface just the
    // message — never the full Error (its `stack` can sometimes include the
    // offending argv which is fine here but we want stable one-line output).
    const message = err instanceof Error ? err.message : 'failed to parse arguments';
    return { error: message };
  }
}

function printUsage(): void {
  process.stderr.write(
    'Usage: ts-node prisma/scripts/force-recovery-rotation.ts --username <name> [--dry-run]\n',
  );
}

async function runCli(): Promise<number> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(`force-recovery-rotation: ${parsed.error}\n`);
    printUsage();
    return 1;
  }

  const client = new PrismaClient();
  try {
    const result = await forceRecoveryRotation(client, parsed.username, {
      dryRun: parsed.dryRun,
    });

    const normalised = normaliseUsername(parsed.username);

    if (result.status === 'not-found') {
      // Keep this message byte-identical between dry-run and real-run so the
      // operator sees the same thing either way.
      process.stderr.write(`force-recovery-rotation: user not found: ${normalised}\n`);
      return 2;
    }

    if (result.status === 'would-invalidate') {
      process.stdout.write(
        `force-recovery-rotation: would invalidate recovery wrap for user ${normalised} (id=${result.userId})\n`,
      );
      return 0;
    }

    // status === 'invalidated'
    process.stdout.write(
      `force-recovery-rotation: invalidated recovery wrap for user \`${normalised}\` (id=${result.userId}) — password wrap and narrative content untouched.\n`,
    );
    return 0;
  } finally {
    await client.$disconnect();
  }
}

// Only execute the CLI side-effect when invoked as a script, not when
// imported as a module (tests import `forceRecoveryRotation` directly).
// backend/tsconfig.json targets CommonJS, so `require.main === module` is
// the correct guard here — same pattern used by prisma/seed.ts's lifecycle
// hooks, adapted to an async/await entrypoint.
if (require.main === module) {
  runCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      // Never dump the full error in case a driver-level exception carries
      // query parameters through its message. Log only the name + a generic
      // notice; the operator can rerun with DEBUG=prisma:* if they need more.
      const name = err instanceof Error ? err.name : 'UnknownError';
      process.stderr.write(`force-recovery-rotation: aborted (${name})\n`);
      process.exit(1);
    });
}
