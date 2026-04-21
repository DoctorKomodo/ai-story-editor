import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../src/services/auth.service';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'password';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, passwordHash },
  });

  // Wipe the demo user's existing stories so re-seeding is idempotent.
  await prisma.story.deleteMany({ where: { userId: user.id } });

  const story = await prisma.story.create({
    data: {
      title: 'The Lantern Keeper',
      synopsis:
        'A young lantern-keeper on the cliffs of Oren discovers the lights she tends are not meant for ships.',
      genre: 'fantasy',
      worldNotes:
        'Coastal kingdom of Oren. Two moons. Sea mist hides things that walk between them.',
      userId: user.id,
    },
  });

  const chapter1Content =
    'Maren climbed the stairs of the west lighthouse an hour before dusk. ' +
    'The wind tasted of salt and something older, the way it always did this close to the second tide. ' +
    'She set the flame, and for a moment it burned green.';

  const chapter2Content =
    'The stranger came with the fog. He did not knock. ' +
    'Maren found him sitting at her kitchen table as if he had always been there, ' +
    'turning a brass compass between his fingers, watching the needle refuse to settle.';

  await prisma.chapter.createMany({
    data: [
      {
        title: 'The Green Flame',
        content: chapter1Content,
        orderIndex: 0,
        wordCount: countWords(chapter1Content),
        storyId: story.id,
      },
      {
        title: 'A Visitor Out of the Fog',
        content: chapter2Content,
        orderIndex: 1,
        wordCount: countWords(chapter2Content),
        storyId: story.id,
      },
    ],
  });

  await prisma.character.createMany({
    data: [
      {
        name: 'Maren Oake',
        role: 'protagonist',
        physicalDescription:
          'Nineteen, short and wiry, hair the colour of damp rope. A burn scar across her right palm.',
        personality:
          'Stubborn, observant, more comfortable with machines than with people.',
        backstory:
          'Orphaned at seven when the west lighthouse keeper — her father — vanished during a green-tide storm.',
        notes: 'Left-handed. Keeps a salt-stained notebook of every ship she sees.',
        storyId: story.id,
      },
      {
        name: 'The Stranger',
        role: 'mentor / mystery',
        physicalDescription:
          'Tall, thin, ageless. Wears a coat stitched from at least four different uniforms.',
        personality: 'Patient, amused, speaks in half-answers.',
        backstory: 'Unknown. Claims to have known Maren\'s father.',
        notes: 'Never seen eating or sleeping. His compass points at people, not north.',
        storyId: story.id,
      },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    stories: await prisma.story.count({ where: { userId: user.id } }),
    chapters: await prisma.chapter.count({ where: { storyId: story.id } }),
    characters: await prisma.character.count({ where: { storyId: story.id } }),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
