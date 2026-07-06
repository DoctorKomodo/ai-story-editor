import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

/**
 * Wipe every table in FK-safe order (children before parents) and reset the
 * in-memory session store. beforeEach/afterEach teardown for suites that
 * create narrative rows.
 */
export async function resetDb(): Promise<void> {
  _resetSessionStore();
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.draft.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Cheaper teardown for suites whose rows all hang off `User`: delete users
 * (narrative rows cascade via `onDelete: Cascade`) and reset the in-memory
 * session store.
 */
export async function resetUsers(): Promise<void> {
  _resetSessionStore();
  await prisma.user.deleteMany();
}
