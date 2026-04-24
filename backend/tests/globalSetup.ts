import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test';

export async function setup(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..');
  const resetScript = path.resolve(rootDir, '..', 'scripts', 'db-test-reset.sh');

  if (fs.existsSync(resetScript)) {
    execSync(`bash ${resetScript}`, { stdio: 'inherit' });
  }

  const migrationsDir = path.resolve(rootDir, 'prisma', 'migrations');
  const hasMigrations =
    fs.existsSync(migrationsDir) &&
    fs.readdirSync(migrationsDir).some((name) => /^\d+_/.test(name));

  const syncCmd = hasMigrations
    ? 'npx prisma migrate deploy'
    : 'npx prisma db push --skip-generate --accept-data-loss';

  execSync(syncCmd, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

export async function teardown(): Promise<void> {
  // Postgres data is kept for post-mortem inspection; the next run drops it.
}
