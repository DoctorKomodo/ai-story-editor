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

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createOutlineRepo } from '../../src/repos/outline.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { makeUserContext, resetAllTables } from '../repos/_req';
import { prisma, testDatabaseUrl } from '../setup';

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
      orderIndex: 0,
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
      // [V26] Also seed the new encrypted-at-rest citations column.
      citationsJson: [
        {
          title: `cit-title ${SENTINEL}`,
          url: `https://example.com/${SENTINEL}`,
          snippet: `cit-snippet ${SENTINEL}`,
          publishedAt: null,
        },
      ],
      model: 'plain-model-ok',
    });

    // Raw scan — zero Prisma, zero repo layer.
    type Hit = { table: string; column: string; rowId: string | null };
    const hits: Hit[] = [];

    for (const table of NARRATIVE_TABLES) {
      const { rows } = await pg.query<Record<string, unknown>>(`SELECT * FROM "${table}"`);
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
    // against an empty DB would be a false negative. Serialised because `pg`
    // is a single Client; concurrent .query() on one Client is deprecated.
    const counts: number[] = [];
    for (const t of NARRATIVE_TABLES) {
      const r = await pg.query<{ c: string }>(`SELECT count(*)::text AS c FROM "${t}"`);
      counts.push(Number(r.rows[0]!.c));
    }
    for (let i = 0; i < NARRATIVE_TABLES.length; i += 1) {
      expect(
        counts[i],
        `expected at least 1 row in "${NARRATIVE_TABLES[i]}" — the test didn't seed anything`,
      ).toBeGreaterThan(0);
    }
  });

  // [E13] Seed-script leak proof. The verify command for [E13] is
  //   npx ts-node prisma/seed.ts && vitest ... --grep seed
  // so THIS test is what the "--grep seed" half runs. Without a matching test,
  // Vitest exits 0 with zero tests — which would technically pass but defeat
  // the spec's intent. We spawn the real seed script against the test DB and
  // prove the seeded plaintext never lands on disk.
  it('seed script does not leak plaintext to disk', async () => {
    // Snippets picked from the seed fixtures. Each contains a space (so it
    // can't false-positive against base64 ciphertext) and is specific enough
    // to the seed that an accidental match would be meaningful.
    //
    // IMPORTANT: keep these in sync with backend/prisma/seed.ts. If a fixture
    // is renamed and this list isn't updated, the test will still pass but
    // will no longer prove anything about the renamed field.
    const SEED_SNIPPETS = [
      'The Lantern Keeper', // story title
      'Maren Oake', // character name
      'A Visitor Out of the Fog', // chapter title
    ];

    // Locate the backend repo root from the test file — vitest's CWD varies
    // depending on how it's invoked.
    const backendRoot = path.resolve(__dirname, '..', '..');

    const result = spawnSync('npx', ['ts-node', 'prisma/seed.ts'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        // Force the seed into the test DB. setup.ts pins DATABASE_URL for this
        // process, but the spawned child sees its own env — be explicit.
        DATABASE_URL: testDatabaseUrl,
        // The seed calls auth.register() which doesn't need JWT secrets, but
        // auth.service reads them at module load for other exports. Ensure
        // they're set to something so the import side-effect doesn't explode.
        JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret',
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET ?? 'test-refresh-secret',
        APP_ENCRYPTION_KEY:
          process.env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 0xab).toString('base64'),
      },
      encoding: 'utf8',
      // 2 minutes is generous — the seed does ~4× argon2id derivations (~400ms)
      // plus a couple of network round trips to postgres. A real run is well
      // under 5s; the budget is so a congested CI host doesn't flake.
      timeout: 120_000,
    });

    if (result.status !== 0 || result.signal != null) {
      // Surface stdout+stderr only — the seed intentionally never logs narrative
      // plaintext, and we'd rather fail loudly than swallow an error. Include
      // the signal so a timeout (status=null, signal=SIGTERM) is distinguishable
      // from a real non-zero exit in the CI log.
      throw new Error(
        `[E13] seed script failed (status=${result.status}, signal=${result.signal ?? 'none'}): ` +
          `stdout=<<<${result.stdout}>>> stderr=<<<${result.stderr}>>>`,
      );
    }

    // Scan every narrative table for any of the seed snippets. Matching on
    // ANY snippet in ANY row fails the test.
    type Hit = { table: string; column: string; snippet: string; rowId: string | null };
    const hits: Hit[] = [];

    for (const table of NARRATIVE_TABLES) {
      const { rows } = await pg.query<Record<string, unknown>>(`SELECT * FROM "${table}"`);
      for (const row of rows) {
        const rowId = typeof row.id === 'string' ? row.id : null;
        for (const [col, val] of Object.entries(row)) {
          if (val == null) continue;
          let asText: string;
          if (typeof val === 'string') {
            asText = val;
          } else if (Buffer.isBuffer(val)) {
            asText = val.toString('utf8');
          } else if (typeof val === 'object') {
            asText = JSON.stringify(val);
          } else {
            asText = String(val);
          }
          for (const snippet of SEED_SNIPPETS) {
            if (asText.includes(snippet)) {
              hits.push({ table, column: col, snippet, rowId });
            }
          }
        }
      }
    }

    if (hits.length > 0) {
      const summary = hits
        .map(
          (h) =>
            `${h.table}.${h.column} matched '${h.snippet}'${h.rowId ? ` (row ${h.rowId})` : ''}`,
        )
        .join(', ');
      throw new Error(`[E13] seed leaked plaintext to disk at: ${summary}`);
    }

    // Sanity: the seed must have actually populated Story / Chapter / Character.
    // A silent seed failure that produced zero rows would otherwise pass the
    // no-leak check trivially. OutlineItem / Chat / Message are not written by
    // the seed, so we only assert on the three tables the seed touches.
    const SEEDED_TABLES = ['Story', 'Chapter', 'Character'] as const;
    for (const t of SEEDED_TABLES) {
      const r = await pg.query<{ c: string }>(`SELECT count(*)::text AS c FROM "${t}"`);
      expect(
        Number(r.rows[0]!.c),
        `expected at least 1 row in "${t}" — seed produced nothing`,
      ).toBeGreaterThan(0);
    }

    // Tidy up so subsequent tests start clean. resetAllTables in afterEach
    // will also cover this, but be explicit — the seed created a real user
    // row we don't want bleeding into the leak summary of an unrelated test.
    await prisma.user.deleteMany({ where: { username: 'demo' } });
  });
});
