import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import {
  TEMPLATE_DATABASE_URL,
  TEST_WORKER_COUNT,
  templateDatabaseName,
  workerDatabaseName,
} from './worker-db';

function runQuiet(cmd: string, opts: Parameters<typeof execSync>[1] = {}): void {
  try {
    execSync(cmd, { ...opts, stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    // execSync throws a SpawnSyncError with the child's stdout/stderr attached.
    const x = e as { stdout?: string | Buffer; stderr?: string | Buffer };
    if (x.stdout) process.stderr.write(x.stdout.toString());
    if (x.stderr) process.stderr.write(x.stderr.toString());
    throw e;
  }
}

async function createDatabaseFromTemplate(client: Client, cloneName: string): Promise<void> {
  // `CREATE DATABASE ... TEMPLATE` fails with SQLSTATE 55006 while ANY
  // connection to the template is open. The migrate step above runs in a
  // child process whose connection closes on exit, but Postgres can lag a
  // beat behind the socket close (and CI's boot-smoke step may leave a
  // dying connection). Clones are created serially from this single
  // process, so there is no cross-worker race to lock against — a short
  // retry loop is all that's needed.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.query(`CREATE DATABASE "${cloneName}" TEMPLATE "${templateDatabaseName()}"`);
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== '55006' || attempt >= 20) throw e;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function recreateWorkerClones(): Promise<void> {
  // Maintenance connection: never the template (our own connection would
  // block the TEMPLATE clause), so use the server's built-in `postgres` DB.
  const adminUrl = new URL(TEMPLATE_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    // Drop EVERY existing clone first — any pool id, from any previous
    // worker count — so a schema migration on the template can never leave
    // an old-schema clone alive for a later run to pick up. FORCE kills
    // connections a crashed previous run may have left behind.
    const likePattern = `${templateDatabaseName().replace(/[\\_%]/g, (m) => `\\${m}`)}\\_w%`;
    const stale = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [likePattern],
    );
    for (const row of stale.rows) {
      await client.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
    }
    for (let poolId = 1; poolId <= TEST_WORKER_COUNT; poolId++) {
      await createDatabaseFromTemplate(client, workerDatabaseName(String(poolId)));
    }
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..');
  const resetScript = path.resolve(rootDir, '..', 'scripts', 'db-test-reset.sh');

  // `db-test-reset.sh` drops + recreates the test DB via `docker exec` against
  // the local docker-compose stack and sources `.env.test`. Neither exists in
  // CI: the postgres service container is minted fresh per run (so no reset
  // needed), `.env.test` is gitignored, and CI sets DATABASE_URL directly in
  // the workflow env block. Skip the reset when CI=true; the migrate below
  // handles schema sync against whatever DB the CI env points at.
  const inCI = process.env.CI === 'true' || process.env.CI === '1';
  if (!inCI && fs.existsSync(resetScript)) {
    runQuiet(`bash ${resetScript}`);
  }

  const migrationsDir = path.resolve(rootDir, 'prisma', 'migrations');
  const hasMigrations =
    fs.existsSync(migrationsDir) &&
    fs.readdirSync(migrationsDir).some((name) => /^\d+_/.test(name));

  const syncCmd = hasMigrations
    ? 'npx prisma migrate deploy'
    : 'npx prisma db push --skip-generate --accept-data-loss';

  runQuiet(syncCmd, {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: TEMPLATE_DATABASE_URL },
  });

  // The migrated DB above is only the TEMPLATE. Workers run against fresh
  // per-worker clones of it (see tests/worker-db.ts).
  await recreateWorkerClones();
}

export async function teardown(): Promise<void> {
  // Worker clones are kept for post-mortem inspection; the next run drops
  // and recreates them from the freshly migrated template.
}
