# Self-Hosting Inkwell

This document covers the operator-facing responsibilities for running Inkwell (story-editor) on your own infrastructure. Sections marked `[I6]` are stubs to be fleshed out in the I-series (infra tasks) — this file initially exists to satisfy `[E15]`, the key-backup and user-recovery guidance, which must be in place before any public instance is launched.

---

## Key backup and user recovery (`[E15]`)

Inkwell's encryption-at-rest protects both narrative content and BYOK Venice keys through user-derived secrets only — there is no server-held encryption key. Back up the database, and communicate the user-facing key-management responsibility clearly to your users.

> **Upgrade note (retiring `APP_ENCRYPTION_KEY`):** If you are upgrading from a version prior to [story-editor-nst], `APP_ENCRYPTION_KEY` is no longer needed and can be removed from your `.env`. After upgrading, each user re-enters their Venice API key once in Settings; the newly stored key is encrypted under their per-user DEK instead.

### 1. No server-held encryption key — database is the only secret surface

In the current design there is **no `APP_ENCRYPTION_KEY`** or equivalent server-side encryption env var. Both narrative content and the BYOK Venice API key are protected by the same per-user envelope scheme (below). An attacker who obtains a database dump **and** your `.env` file learns nothing more than from the dump alone — there is no env key that decrypts anything.

**Backup requirements:**
- Back up the **Postgres database** (`pgdata` volume). That's the only server-side secret surface.
- Keep off-site copies away from the machine (see "Off-site copies" below).

### 2. Content DEKs and Venice keys — user-derived secrets (user's responsibility)

Each user's narrative content (stories, chapters, characters, outline, chats, messages) **and their stored BYOK Venice API key** are encrypted with a **per-user 32-byte random DEK** that is wrapped **twice**:
- **Password wrap** — argon2id-derived from the user's password.
- **Recovery-code wrap** — argon2id-derived from a one-time recovery code shown **exactly once** at signup.

The server has **no third wrap**. There is no operator-held master key for narrative content or Venice keys. This is intentional:

> **Losing both the password and the recovery code for a given user = irrecoverable data loss for that user's narrative content and their stored Venice API key.**

Neither you nor Anthropic nor any operator can decrypt that user's data when both secrets are gone. By design.

**User-facing guidance to communicate in your signup flow and user docs:**
- The recovery code is shown **once** at registration. Save it out-of-band immediately:
  - Printed on paper and filed.
  - In a password manager (1Password, Bitwarden, etc.) as a separate entry from the password.
  - Offline on a USB stick kept in a different physical location from the laptop.
- Do **not** store the recovery code in the same place as the password. If the single store is compromised, both copies go with it.
- A user can rotate their recovery code at any time via `POST /api/auth/rotate-recovery-code` (`[AU17]`). Do this after any suspected leak, and after any major life event that might interrupt access to where the code is stored.
- If the user reports their code is leaked and they can still log in, they should rotate it themselves. If they cannot log in, the operator can **invalidate** the old wrap via `backend/prisma/scripts/force-recovery-rotation.ts --username <name>` (`[E14]`). After invalidation, the user logs in with their password and calls AU17 to mint a fresh code.

### 3. Recovery drill (operator guidance)

A scripted version of the drill ships as `scripts/backup-restore-drill.sh`
([I8]). It runs end-to-end against an isolated drill database on the live
postgres (no impact on the primary DB), so you can wire it into a cron or
CI step without touching production data:

```bash
bash scripts/backup-restore-drill.sh
```

Exit code 0 = encrypted user content was successfully recovered. The
manual recipe below is still the recommended human cross-check — at least
once per quarter, and after any Postgres major-version upgrade or schema
migration.

Run a recovery drill on a staging instance at least quarterly. The drill:

1. Register a new demo user. Save the recovery code shown at signup.
2. Log in as the demo user and create a story with a distinctive title (e.g. `"drill-<date>"`).
3. Log out. "Forget" the password — treat it as lost.
4. Use the recovery-code-based password reset flow (`POST /api/auth/reset-password`, `[AU16]`) with the saved recovery code.
5. Log in with the new password.
6. Open the story and confirm the distinctive title decrypts correctly.

If any step fails on staging, resolve it before the next prod backup cycle. A drill that works once does not prove the flow still works after schema migrations, Postgres upgrades, or key-rotation events.

### Summary table

| Secret                 | Held by  | Wraps                                    | Loss consequence                                                        | Recovery path                                         |
|------------------------|----------|------------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------|
| Password               | User     | Content DEK (password wrap)              | DEK accessible via recovery code                                        | Recovery code → password reset via `[AU16]`           |
| Recovery code          | User     | Content DEK (recovery wrap)              | DEK accessible via password                                             | Rotate via `[AU17]` after login with password         |
| **Password + recovery code (both)** | User | DEK — no third wrap exists  | **Narrative content and stored Venice key for that user are permanently lost.** | **None by design.** Re-create account from scratch.   |

---

## Prerequisites

You'll need:

- A Linux host (or macOS / Windows with WSL2). Tested on Ubuntu 22.04+ and Debian 12.
- **Docker Engine 24+** and **Docker Compose v2+** (`docker compose version`).
- **`git`** only if you build from source (the published-images path below needs only `curl`).
- **`node` 22+** *only* if you want to run the test suite or `make migrate` from the host. The bundled stack does not require Node on the host.
- A reverse proxy (nginx, Caddy, Traefik, Cloudflare Tunnel) if you intend to expose the instance to the internet — Inkwell does not ship one.
- A small amount of memory: the default stack peaks around ~600 MB RAM under typical load (postgres + node backend + nginx-fronted SPA).

Inkwell uses a **bring-your-own-key (BYOK)** model for AI features — operators do **not** need a Venice.ai account. Each end-user pastes their own Venice API key into Settings on first AI use. Stored keys are encrypted under the user's own DEK, so the operator has no server-side secret to manage for this.

## Run from published images (recommended)

The fastest path: run the pre-built images from GitHub Container Registry — no
source checkout, no local build. You only need two files in a clean directory.

```bash
# 1. Make a deploy directory and pull down the compose file + env template.
#    Saving the compose file as `docker-compose.yml` means every command is a
#    bare `docker compose …` (no -f to remember).
mkdir inkwell && cd inkwell
curl -L -o docker-compose.yml \
  https://raw.githubusercontent.com/doctorkomodo/ai-story-editor/main/docker-compose.release.yml
curl -L -o .env \
  https://raw.githubusercontent.com/doctorkomodo/ai-story-editor/main/.env.example

# 2. Generate the long-lived secrets and paste them into .env, replacing the
#    placeholder defaults (see the secret-gen block under "First-run steps").
#    JWT_SECRET and REFRESH_TOKEN_SECRET are required.

# 3. Pull the images and start the stack. The backend runs `prisma migrate
#    deploy` automatically on boot, so the schema is created on its own.
docker compose pull
docker compose up -d

# 4. Wait for the app to report healthy (~10s). The published stack exposes
#    only :3000; the health check goes through the frontend's /api proxy.
curl -sf http://localhost:3000/api/health
# {"status":"ok",...}

# 5. Open the UI
open http://localhost:3000
```

`INKWELL_VERSION` selects the image tag and defaults to `latest`, so a plain
`docker compose pull && docker compose up -d` always lands on the newest
release. Pin a specific version for reproducible deploys:

```bash
INKWELL_VERSION=0.2.0 docker compose up -d
```

For testing the bleeding edge, `INKWELL_VERSION=main` pulls the rolling image
built from the latest `main` commit (published by the image-build workflow; not
a stable release). `latest` always points at the most recent tagged release.

**Ports:** the published stack publishes **only `:3000`** — the single public
entry point. The frontend's nginx reverse-proxies `/api/*` to the backend, and
the backend reaches Postgres, both over the internal compose network, so
neither `:4000` nor `:5432` is exposed to the host. If you build the frontend
to call the API on a **separate origin** (`VITE_API_BASE_URL=https://api.example.com/api`),
route `:4000` through your own reverse proxy instead.

## First-run steps (build from source)

Prefer this only if you're modifying the code or can't pull from GHCR.

```bash
# 1. Clone the repo
git clone https://github.com/<your-fork>/story-editor.git
cd story-editor

# 2. Create your .env from the template
cp .env.example .env

# 3. Generate the long-lived secrets the backend requires.
#    JWT_SECRET and REFRESH_TOKEN_SECRET sign access and refresh tokens
#    respectively. There is no server-held encryption key — Venice keys and
#    narrative content are both protected by per-user DEKs.
{
  echo "JWT_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))")"
  echo "REFRESH_TOKEN_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))")"
} >> /tmp/inkwell-secrets.env
# /tmp/inkwell-secrets.env now contains two KEY=VALUE lines with real
# generated secrets — paste them into .env, replacing the placeholder
# defaults, then delete the temp file.

# 4. Bring up the stack — backend runs `prisma migrate deploy` automatically
#    on first boot, so the schema is created on its own.
docker compose up -d

# 5. Wait for /api/health to return 200 (~10s)
curl -sf http://localhost:4000/api/health
# {"status":"ok",...}

# 6. Open the UI
open http://localhost:3000
```

The first user you register is **just a user** — Inkwell has no admin role today. Sign up, then immediately save the recovery code shown on the post-signup screen (see "Key backup and user recovery" → "Content DEKs" above).

If you run the stack on a host other than `localhost`, rebuild the frontend image with the API URL baked in:

```bash
VITE_API_URL=https://api.example.com docker compose build frontend
docker compose up -d frontend
```

## Updating (published images)

```bash
docker compose pull        # fetch the new images (latest, or your pinned INKWELL_VERSION)
docker compose up -d       # rolling-restart; postgres data persists in pgdata
```

To move to a newer pinned release, bump `INKWELL_VERSION` in `.env` (or your
shell) before `pull`. As with the source flow, the backend entrypoint runs
`prisma migrate deploy` on every boot, so migrations apply automatically.

## Updating (from source)

```bash
git pull
docker compose build       # rebuilds backend + frontend with the new code
docker compose up -d       # rolling-restart; postgres data persists in pgdata
```

The backend's container entrypoint runs `prisma migrate deploy` on every boot, so a new release that adds migrations applies them automatically. Migrations are designed to be additive (the project uses Prisma's standard "expand-then-contract" pattern); a backup before a major version bump is still recommended — see "Backup and restore" below.

If the release notes say a migration is destructive (e.g. dropping a plaintext column after an encryption rollout), take a `scripts/backup-db.sh` snapshot first and keep it until you've verified the new release end-to-end.

## Backup and restore

Run a regular backup of the Postgres database (`pgdata` volume). That is the only server-side secret surface — there is no separate server-held encryption key to back up.

### Take a snapshot

```bash
bash scripts/backup-db.sh
# -> backups/inkwell-YYYYMMDD-HHMMSS.sql.gz
```

The script dumps the live database via `pg_dump` inside the postgres container, gzips it on the host, and timestamps the filename.

### Restore from a snapshot

```bash
docker compose down            # stop the stack so writes don't race
docker compose up -d postgres  # start postgres alone
sleep 5

gunzip -c backups/inkwell-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose exec -T postgres psql -U storyeditor -d storyeditor

docker compose up -d           # bring the rest of the stack back
```

After restore, every user's narrative content is decryptable as before *only if* their password and recovery code are unchanged from when the snapshot was taken. (The DEK wraps live in the `User` row inside the dump, so the wrap and the ciphertext travel together.)

### Off-site copies

`./backups/` is in `.gitignore`. Sync it elsewhere with whatever you already use (`rclone`, `restic`, `borg`). A small cron is fine:

```cron
# Daily 03:00 backup, prune anything older than 30 days
0 3 * * *  cd /opt/inkwell && bash scripts/backup-db.sh
30 3 * * * find /opt/inkwell/backups -name '*.sql.gz' -mtime +30 -delete
```

## Port layout (`[I6]` stub)

Frontend: `:3000`. Backend: `:4000`. No built-in reverse proxy — an operator-supplied upstream (nginx, Caddy, Traefik, Cloudflare Tunnel) is expected. Detailed config in `[I6]`.
