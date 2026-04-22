// [E14] Admin-triggered recovery-wrap invalidation.
//
// Tests exercise `forceRecoveryRotation` from
// `prisma/scripts/force-recovery-rotation.ts` directly (imported as a module;
// the CLI wrapper is not exercised here — it's a thin shell around this
// function). The core invariants we check:
//
//   1. The recovery wrap columns are nulled.
//   2. NOTHING else changes — password wrap, password hash, narrative
//      ciphertext on Story, sessions, refresh tokens.
//   3. Username normalisation matches [AU9] (trim + lowercase).
//   4. Dry-run never writes.
//   5. Idempotent across repeated calls.
//   6. Password login still works after invalidation.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forceRecoveryRotation } from '../../prisma/scripts/force-recovery-rotation';
import { createAuthService } from '../../src/services/auth.service';
import { prisma } from '../setup';

const PASSWORD = 'correct-horse-battery';

interface PasswordWrapSnapshot {
  passwordHash: string;
  contentDekPasswordEnc: string | null;
  contentDekPasswordIv: string | null;
  contentDekPasswordAuthTag: string | null;
  contentDekPasswordSalt: string | null;
}

interface RecoveryWrapSnapshot {
  contentDekRecoveryEnc: string | null;
  contentDekRecoveryIv: string | null;
  contentDekRecoveryAuthTag: string | null;
  contentDekRecoverySalt: string | null;
}

async function registerUser(username: string): Promise<string> {
  const auth = createAuthService(prisma);
  const { user } = await auth.register({
    name: 'Test User',
    username,
    password: PASSWORD,
  });
  return user.id;
}

// IMPORTANT: keep this field list in sync with the password-wrap columns on
// `User` in `schema.prisma`. If a new column is added (e.g. a KDF param /
// iterations field) and NOT mirrored here, the immutability assertion will
// silently stop covering it — mutation of the new column by the admin script
// would go undetected by these tests.
async function readPasswordSnapshot(userId: string): Promise<PasswordWrapSnapshot> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    passwordHash: u.passwordHash,
    contentDekPasswordEnc: u.contentDekPasswordEnc,
    contentDekPasswordIv: u.contentDekPasswordIv,
    contentDekPasswordAuthTag: u.contentDekPasswordAuthTag,
    contentDekPasswordSalt: u.contentDekPasswordSalt,
  };
}

async function readRecoverySnapshot(userId: string): Promise<RecoveryWrapSnapshot> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    contentDekRecoveryEnc: u.contentDekRecoveryEnc,
    contentDekRecoveryIv: u.contentDekRecoveryIv,
    contentDekRecoveryAuthTag: u.contentDekRecoveryAuthTag,
    contentDekRecoverySalt: u.contentDekRecoverySalt,
  };
}

async function seedFakeStory(userId: string): Promise<{
  id: string;
  titleCiphertext: string;
  titleIv: string;
  titleAuthTag: string;
  synopsisCiphertext: string;
  synopsisIv: string;
  synopsisAuthTag: string;
}> {
  // Seed with fake ciphertext triples via raw Prisma — same pattern the
  // rotate-recovery-code tests use. We're not exercising the repo round-trip,
  // only asserting the columns don't mutate when the script runs.
  const story = await prisma.story.create({
    data: {
      userId,
      titleCiphertext: 'FAKE_CIPHER_TITLE',
      titleIv: 'FAKE_IV_TITLE',
      titleAuthTag: 'FAKE_TAG_TITLE',
      synopsisCiphertext: 'FAKE_CIPHER_SYN',
      synopsisIv: 'FAKE_IV_SYN',
      synopsisAuthTag: 'FAKE_TAG_SYN',
    },
  });
  return {
    id: story.id,
    titleCiphertext: story.titleCiphertext!,
    titleIv: story.titleIv!,
    titleAuthTag: story.titleAuthTag!,
    synopsisCiphertext: story.synopsisCiphertext!,
    synopsisIv: story.synopsisIv!,
    synopsisAuthTag: story.synopsisAuthTag!,
  };
}

describe('[E14] forceRecoveryRotation (admin-triggered recovery wrap invalidation)', () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.story.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.story.deleteMany();
    await prisma.user.deleteMany();
  });

  it('happy path: nulls the four recovery columns, leaves password wrap + password hash + narrative ciphertext untouched', async () => {
    const userId = await registerUser('demo');
    const story = await seedFakeStory(userId);

    const passwordBefore = await readPasswordSnapshot(userId);
    // Sanity check — the recovery wrap is populated after [E3]-flavoured register.
    const recoveryBefore = await readRecoverySnapshot(userId);
    expect(recoveryBefore.contentDekRecoveryEnc).not.toBeNull();
    expect(recoveryBefore.contentDekRecoveryIv).not.toBeNull();
    expect(recoveryBefore.contentDekRecoveryAuthTag).not.toBeNull();
    expect(recoveryBefore.contentDekRecoverySalt).not.toBeNull();

    const result = await forceRecoveryRotation(prisma, 'demo');

    expect(result).toEqual({ status: 'invalidated', userId });

    const recoveryAfter = await readRecoverySnapshot(userId);
    expect(recoveryAfter.contentDekRecoveryEnc).toBeNull();
    expect(recoveryAfter.contentDekRecoveryIv).toBeNull();
    expect(recoveryAfter.contentDekRecoveryAuthTag).toBeNull();
    expect(recoveryAfter.contentDekRecoverySalt).toBeNull();

    const passwordAfter = await readPasswordSnapshot(userId);
    expect(passwordAfter).toEqual(passwordBefore);

    // Narrative ciphertext untouched. Script's UPDATE is scoped to User, so
    // spot-checking two triples on Story is sufficient evidence that no
    // narrative row was mutated.
    const storyAfter = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(storyAfter.titleCiphertext).toBe(story.titleCiphertext);
    expect(storyAfter.titleIv).toBe(story.titleIv);
    expect(storyAfter.titleAuthTag).toBe(story.titleAuthTag);
    expect(storyAfter.synopsisCiphertext).toBe(story.synopsisCiphertext);
    expect(storyAfter.synopsisIv).toBe(story.synopsisIv);
    expect(storyAfter.synopsisAuthTag).toBe(story.synopsisAuthTag);
  });

  it('returns not-found and leaves the DB untouched when no user matches', async () => {
    const userId = await registerUser('demo');
    await seedFakeStory(userId);

    const userCountBefore = await prisma.user.count();
    const storyCountBefore = await prisma.story.count();
    const recoveryBefore = await readRecoverySnapshot(userId);

    const result = await forceRecoveryRotation(prisma, 'nonexistent-user');
    expect(result).toEqual({ status: 'not-found', userId: null });

    expect(await prisma.user.count()).toBe(userCountBefore);
    expect(await prisma.story.count()).toBe(storyCountBefore);

    const recoveryAfter = await readRecoverySnapshot(userId);
    expect(recoveryAfter).toEqual(recoveryBefore);
  });

  it('normalises the supplied username (trim + lowercase) — MIXEDCASE matches mixedcase', async () => {
    // Register lowercases via the [AU9] preprocessor, so the stored username
    // is "mixedcase". The admin will typically type the username in whatever
    // case the user reported it in.
    const userId = await registerUser('mixedcase');

    const upper = await forceRecoveryRotation(prisma, 'MIXEDCASE');
    expect(upper).toEqual({ status: 'invalidated', userId });

    // Reset so we can assert lookup succeeds from a different casing too.
    // (The wrap is already null after the first call; we only care that the
    // user is found.)
    const mixed = await forceRecoveryRotation(prisma, '  MixedCase  ');
    expect(mixed).toEqual({ status: 'invalidated', userId });
  });

  it('dry-run: reports would-invalidate and does NOT mutate the recovery wrap or narrative ciphertext', async () => {
    const userId = await registerUser('demo');
    const story = await seedFakeStory(userId);
    const recoveryBefore = await readRecoverySnapshot(userId);
    const passwordBefore = await readPasswordSnapshot(userId);

    const result = await forceRecoveryRotation(prisma, 'demo', { dryRun: true });
    expect(result).toEqual({ status: 'would-invalidate', userId });

    const recoveryAfter = await readRecoverySnapshot(userId);
    expect(recoveryAfter).toEqual(recoveryBefore);
    const passwordAfter = await readPasswordSnapshot(userId);
    expect(passwordAfter).toEqual(passwordBefore);

    const storyAfter = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(storyAfter.titleCiphertext).toBe(story.titleCiphertext);
    expect(storyAfter.titleIv).toBe(story.titleIv);
    expect(storyAfter.titleAuthTag).toBe(story.titleAuthTag);
  });

  it('dry-run with unknown user returns not-found without writing', async () => {
    const userCountBefore = await prisma.user.count();
    const result = await forceRecoveryRotation(prisma, 'nobody', { dryRun: true });
    expect(result).toEqual({ status: 'not-found', userId: null });
    expect(await prisma.user.count()).toBe(userCountBefore);
  });

  it('is idempotent across repeated invalidations', async () => {
    const userId = await registerUser('demo');

    const first = await forceRecoveryRotation(prisma, 'demo');
    expect(first).toEqual({ status: 'invalidated', userId });
    const afterFirst = await readRecoverySnapshot(userId);
    expect(afterFirst.contentDekRecoveryEnc).toBeNull();

    // Second call should not throw and should keep columns null.
    const second = await forceRecoveryRotation(prisma, 'demo');
    expect(second).toEqual({ status: 'invalidated', userId });
    const afterSecond = await readRecoverySnapshot(userId);
    expect(afterSecond).toEqual(afterFirst);
  });

  it('password login still works after invalidation — password wrap is untouched by the admin action', async () => {
    const userId = await registerUser('demo');
    const result = await forceRecoveryRotation(prisma, 'demo');
    expect(result).toEqual({ status: 'invalidated', userId });

    const auth = createAuthService(prisma);
    const loginResult = await auth.login({ username: 'demo', password: PASSWORD });
    expect(loginResult.accessToken).toBeTypeOf('string');
    expect(loginResult.accessToken.length).toBeGreaterThan(0);
    expect(loginResult.user.id).toBe(userId);
  });

  it('does not revoke existing sessions or refresh tokens — this is a key-management action, not a session revocation', async () => {
    const userId = await registerUser('demo');

    // Log in first so a session + refresh token exist.
    const auth = createAuthService(prisma);
    await auth.login({ username: 'demo', password: PASSWORD });

    const rtBefore = await prisma.refreshToken.count({ where: { userId } });
    const sBefore = await prisma.session.count({ where: { userId } });
    expect(rtBefore).toBeGreaterThanOrEqual(1);
    expect(sBefore).toBeGreaterThanOrEqual(1);

    const result = await forceRecoveryRotation(prisma, 'demo');
    expect(result).toEqual({ status: 'invalidated', userId });

    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(rtBefore);
    expect(await prisma.session.count({ where: { userId } })).toBe(sBefore);
  });
});
