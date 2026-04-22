// [E12] Encryption leak test.
//
// Seed every narrative entity (Story, Chapter, Character, OutlineItem, Chat,
// Message) through the repo layer with a sentinel string embedded in its
// narrative fields, then open a *raw* `pg` connection (bypassing Prisma +
// the repo layer) and scan every row of every narrative table. The sentinel
// must not appear anywhere — a match proves plaintext narrative content
// landed on disk, which would break the envelope-encryption contract.
//
// Failure messages include the table + column but NEVER the row content —
// otherwise the leak test output would itself be a leak channel.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createOutlineRepo } from '../../src/repos/outline.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { testDatabaseUrl } from '../setup';
import { makeUserContext, resetAllTables } from '../repos/_req';

const SENTINEL = 'SENTINEL_E12_DO_NOT_LEAK';

// Physical table names match Prisma's default (PascalCase model names). See
// backend/prisma/migrations/*/migration.sql `CREATE TABLE` statements.
const NARRATIVE_TABLES = [
  'Story',
  'Chapter',
  'Character',
  'OutlineItem',
  'Chat',
  'Message',
] as const;

describe('[E12] encryption leak — no narrative plaintext reaches disk', () => {
  let pg: Client;

  beforeEach(async () => {
    await resetAllTables();
    pg = new Client({ connectionString: testDatabaseUrl });
    await pg.connect();
  });

  afterEach(async () => {
    await pg.end();
    await resetAllTables();
  });

  afterAll(async () => {
    // Defensive: if a test throws before afterEach, make sure we don't leak
    // a dangling pg connection into the next test file.
    try {
      await pg.end();
    } catch {
      /* already ended */
    }
  });

  it('no narrative table row contains the sentinel after a full repo write of every entity type', async () => {
    const ctx = await makeUserContext('leak-e12');

    // Write every narrative entity through the repo layer, burying the
    // sentinel in each field that's supposed to be encrypted at rest.
    const storyRepo = createStoryRepo(ctx.req);
    const chapterRepo = createChapterRepo(ctx.req);
    const characterRepo = createCharacterRepo(ctx.req);
    const outlineRepo = createOutlineRepo(ctx.req);
    const chatRepo = createChatRepo(ctx.req);
    const messageRepo = createMessageRepo(ctx.req);

    const story = await storyRepo.create({
      title: `story-title ${SENTINEL}`,
      synopsis: `synopsis ${SENTINEL}`,
      worldNotes: `world-notes ${SENTINEL}`,
      systemPrompt: `system-prompt ${SENTINEL}`,
      genre: 'genre-plain-ok',
      targetWords: 10_000,
    });

    const chapter = await chapterRepo.create({
      storyId: story.id as string,
      title: `chapter-title ${SENTINEL}`,
      bodyJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `body ${SENTINEL}` }],
          },
        ],
      },
      orderIndex: 0,
      wordCount: 3,
    });

    await characterRepo.create({
      storyId: story.id as string,
      name: `char-name ${SENTINEL}`,
      role: `role ${SENTINEL}`,
      age: `age ${SENTINEL}`,
      appearance: `appearance ${SENTINEL}`,
      voice: `voice ${SENTINEL}`,
      arc: `arc ${SENTINEL}`,
      physicalDescription: `physical ${SENTINEL}`,
      personality: `personality ${SENTINEL}`,
      backstory: `backstory ${SENTINEL}`,
      notes: `notes ${SENTINEL}`,
      color: 'plain-color-ok',
      initial: 'C',
    });

    await outlineRepo.create({
      storyId: story.id as string,
      order: 0,
      title: `outline-title ${SENTINEL}`,
      sub: `outline-sub ${SENTINEL}`,
      status: 'plain-status-ok',
    });

    const chat = await chatRepo.create({
      chapterId: chapter.id as string,
      title: `chat-title ${SENTINEL}`,
    });

    await messageRepo.create({
      chatId: chat.id as string,
      role: 'user',
      contentJson: { parts: [`message-content ${SENTINEL}`] },
      attachmentJson: { ref: `message-attach ${SENTINEL}` },
      model: 'plain-model-ok',
    });

    // Raw scan — zero Prisma, zero repo layer.
    type Hit = { table: string; column: string; rowId: string | null };
    const hits: Hit[] = [];

    for (const table of NARRATIVE_TABLES) {
      const { rows } = await pg.query<Record<string, unknown>>(
        `SELECT * FROM "${table}"`,
      );
      for (const row of rows) {
        const rowId = typeof row.id === 'string' ? row.id : null;
        for (const [col, val] of Object.entries(row)) {
          // Bail fast on types that can't embed a string.
          if (val == null) continue;
          let asText: string;
          if (typeof val === 'string') {
            asText = val;
          } else if (Buffer.isBuffer(val)) {
            asText = val.toString('utf8');
          } else if (typeof val === 'object') {
            // JSON / JSONB / arrays etc. serialise for substring scan.
            asText = JSON.stringify(val);
          } else {
            asText = String(val);
          }
          if (asText.includes(SENTINEL)) {
            hits.push({ table, column: col, rowId });
          }
        }
      }
    }

    if (hits.length > 0) {
      // Surface the table + column but NEVER the row content — the whole
      // point of this test is to prove narrative content isn't observable.
      const summary = hits
        .map((h) => `${h.table}.${h.column}${h.rowId ? ` (row ${h.rowId})` : ''}`)
        .join(', ');
      throw new Error(
        `[E12] sentinel '${SENTINEL}' leaked into narrative plaintext at: ${summary}`,
      );
    }

    // Sanity: assert the test actually wrote rows to scan — a passing test
    // against an empty DB would be a false negative.
    const counts = await Promise.all(
      NARRATIVE_TABLES.map(async (t) => {
        const r = await pg.query<{ c: string }>(`SELECT count(*)::text AS c FROM "${t}"`);
        return Number(r.rows[0]!.c);
      }),
    );
    for (let i = 0; i < NARRATIVE_TABLES.length; i += 1) {
      expect(
        counts[i],
        `expected at least 1 row in "${NARRATIVE_TABLES[i]}" — the test didn't seed anything`,
      ).toBeGreaterThan(0);
    }
  });
});
