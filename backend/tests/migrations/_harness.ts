import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { Client } from 'pg';

// Shared plumbing for the opt-in migration tests in this directory
// (vitest.squash.config.ts; run via `npm run test:migration-squash` with the
// compose stack up). Each test file owns its scratch-DB name, fixture, seed
// data, and assertions; everything below is the common scratch-DB lifecycle.

const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');
const CONTAINER = process.env.POSTGRES_CONTAINER ?? 'story-editor-postgres-1';

dotenvConfig({ path: path.join(REPO_ROOT, '.env.test') });
const templateUrl = process.env.DATABASE_URL;
if (!templateUrl) {
  throw new Error('DATABASE_URL missing — copy .env.test.example to .env.test first');
}

export function dbUrl(dbName: string): string {
  const url = new URL(templateUrl as string);
  url.pathname = `/${dbName}`;
  return url.toString();
}

// SQL literal for raw-SQL seed inserts (the pre-migration schemas are
// unknown to the current Prisma client, by design).
export function lit(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

export function makeMigrationHarness(opts: { scratchDb: string; fixture: string }) {
  const scratchUrl = dbUrl(opts.scratchDb);
  const dbUser = new URL(templateUrl as string).username;
  let maintenance: Client | undefined;

  function loadFixture(): void {
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        CONTAINER,
        'psql',
        '-U',
        dbUser,
        '-d',
        opts.scratchDb,
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        '-',
      ],
      { input: fs.readFileSync(opts.fixture) },
    );
  }

  function migrateDeploy(): string {
    return execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: scratchUrl },
      encoding: 'utf8',
    });
  }

  // Drops + recreates the scratch DB, loads the fixture, and returns a
  // connected client on it. Pair with teardown() in afterAll.
  async function setup(): Promise<Client> {
    maintenance = new Client({ connectionString: dbUrl('postgres') });
    await maintenance.connect();
    await maintenance.query(`DROP DATABASE IF EXISTS ${opts.scratchDb} WITH (FORCE)`);
    await maintenance.query(`CREATE DATABASE ${opts.scratchDb}`);
    loadFixture();
    const scratch = new Client({ connectionString: scratchUrl });
    await scratch.connect();
    return scratch;
  }

  // Always drops the scratch DB — a deterministic re-run matters more than
  // leaving a failed run's DB inspectable.
  async function teardown(scratch: Client | undefined): Promise<void> {
    await scratch?.end();
    await maintenance?.query(`DROP DATABASE IF EXISTS ${opts.scratchDb} WITH (FORCE)`);
    await maintenance?.end();
  }

  return { scratchUrl, migrateDeploy, setup, teardown };
}
