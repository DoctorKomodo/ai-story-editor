// [E13] Seed script — writes demo data via the repo layer so everything lands
// encrypted at rest (no plaintext narrative columns exist post-[E11]).
//
// Flow:
//   1. Ensure the demo user is fresh (delete-then-create) — see idempotency note.
//   2. Call auth.register() which generates the DEK + both wraps + persists the
//      User row atomically. This is the AU9 registration path.
//   3. Call unwrapDekWithPassword() with the password we just used so we have
//      the raw DEK buffer in hand.
//   4. Build a minimal fake Express `req` object, attach the DEK to it via
//      content-crypto's request-scoped WeakMap, and hand that `req` to each
//      repo — the repos only need `req.user.id` + a DEK entry in the map.
//   5. Seed the demo story / chapters / characters through those repos.
//
// Idempotency: we delete the demo user (cascade wipes their data) and
// recreate them. Alternative — call register(), catch UsernameUnavailableError,
// unwrap the existing user's DEK with the known password — works but yields a
// fresh recoveryCode each run anyway (we can't recover the old one), so the
// delete-and-recreate path is strictly simpler with the same observable result.
//
// Credentials:
//   username:  "demo"      (matches /^[a-z0-9_-]{3,32}$/)
//   password:  "demopass123" (≥ 8 chars, clears the production threshold)
//   recoveryCode: printed at the end of the run — operator must copy it if
//                 they want to exercise the recovery/reset flows.
//
// NOTE: we log the recoveryCode (seed-only convenience) and the creds — we
// do NOT log any narrative plaintext (story title, character bios, etc.).
// Keeping that discipline here matches the production contract even in dev.

import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { createChapterRepo } from '../src/repos/chapter.repo';
import { createCharacterRepo } from '../src/repos/character.repo';
import { createStoryRepo } from '../src/repos/story.repo';
import { createAuthService } from '../src/services/auth.service';
import { attachDekToRequest, unwrapDekWithPassword } from '../src/services/content-crypto.service';

const prisma = new PrismaClient();

const DEMO_USERNAME = 'demo';
const DEMO_NAME = 'Demo Writer';
const DEMO_PASSWORD = 'demopass123';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Build a TipTap-shaped JSON tree from a plain string so the chapter body
// matches what the editor would emit. The repo serialises + encrypts this.
function paragraphDoc(text: string): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

async function main(): Promise<void> {
  // 1) Ensure idempotency. Cascade drops the demo user's stories / chapters /
  //    characters / outline / chats / messages along with them.
  await prisma.user.deleteMany({ where: { username: DEMO_USERNAME } });

  // 2) Register via AU9. This writes the User row + both DEK wraps in one
  //    transaction and returns the one-time recovery code.
  const auth = createAuthService(prisma);
  const { user, recoveryCode } = await auth.register({
    name: DEMO_NAME,
    username: DEMO_USERNAME,
    password: DEMO_PASSWORD,
  });

  // 3) Unwrap the DEK with the password we just used. We need the raw buffer
  //    to attach it to our seed request so the repo layer can encrypt.
  const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const dek = await unwrapDekWithPassword(full, DEMO_PASSWORD);

  // 4) Fake request object — the repos only read `req.user.id` and look up
  //    the DEK in a WeakMap keyed by the req identity. Any object will do.
  //    We stick a `__seed` marker on it so accidental logs make it obvious
  //    where the req came from if something ever inspected it.
  const seedReq = { __seed: true, user: { id: user.id, email: full.email } } as unknown as Request;
  attachDekToRequest(seedReq, dek);

  // 5) Seed the narrative data via the repo layer.
  const storyRepo = createStoryRepo(seedReq, prisma);
  const chapterRepo = createChapterRepo(seedReq, prisma);
  const characterRepo = createCharacterRepo(seedReq, prisma);

  const story = await storyRepo.create({
    title: 'The Lantern Keeper',
    synopsis:
      'A young lantern-keeper on the cliffs of Oren discovers the lights she tends are not meant for ships.',
    genre: 'fantasy',
    worldNotes: 'Coastal kingdom of Oren. Two moons. Sea mist hides things that walk between them.',
  });

  const chapter1Text =
    'Maren climbed the stairs of the west lighthouse an hour before dusk. ' +
    'The wind tasted of salt and something older, the way it always did this close to the second tide. ' +
    'She set the flame, and for a moment it burned green.';

  const chapter2Text =
    'The stranger came with the fog. He did not knock. ' +
    'Maren found him sitting at her kitchen table as if he had always been there, ' +
    'turning a brass compass between his fingers, watching the needle refuse to settle.';

  await chapterRepo.create({
    storyId: story.id as string,
    title: 'The Green Flame',
    bodyJson: paragraphDoc(chapter1Text),
    orderIndex: 0,
    // wordCount is plaintext — derived from the TipTap JSON *before* encryption
    // per the CLAUDE.md "Known Gotchas" note.
    wordCount: countWords(chapter1Text),
  });

  await chapterRepo.create({
    storyId: story.id as string,
    title: 'A Visitor Out of the Fog',
    bodyJson: paragraphDoc(chapter2Text),
    orderIndex: 1,
    wordCount: countWords(chapter2Text),
  });

  await characterRepo.create({
    storyId: story.id as string,
    name: 'Maren Oake',
    role: 'protagonist',
    physicalDescription:
      'Nineteen, short and wiry, hair the colour of damp rope. A burn scar across her right palm.',
    personality: 'Stubborn, observant, more comfortable with machines than with people.',
    backstory:
      'Orphaned at seven when the west lighthouse keeper — her father — vanished during a green-tide storm.',
    notes: 'Left-handed. Keeps a salt-stained notebook of every ship she sees.',
  });

  await characterRepo.create({
    storyId: story.id as string,
    name: 'The Stranger',
    role: 'mentor / mystery',
    physicalDescription:
      'Tall, thin, ageless. Wears a coat stitched from at least four different uniforms.',
    personality: 'Patient, amused, speaks in half-answers.',
    backstory: "Unknown. Claims to have known Maren's father.",
    notes: 'Never seen eating or sleeping. His compass points at people, not north.',
  });

  const counts = {
    users: await prisma.user.count(),
    stories: await prisma.story.count({ where: { userId: user.id } }),
    chapters: await prisma.chapter.count({ where: { storyId: story.id as string } }),
    characters: await prisma.character.count({ where: { storyId: story.id as string } }),
  };

  // Seed summary — credentials + the one-time recoveryCode for the operator.
  // Intentionally NO narrative plaintext in this log.
  console.log('Seed complete:', counts);
  console.log('Demo credentials:');
  console.log(`  username:      ${DEMO_USERNAME}`);
  console.log(`  password:      ${DEMO_PASSWORD}`);
  console.log(`  recoveryCode:  ${recoveryCode}`);
  console.log('(Save the recoveryCode now — it will not be shown again.)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
