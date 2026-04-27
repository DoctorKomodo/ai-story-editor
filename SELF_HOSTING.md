# Self-Hosting Inkwell

This document covers the operator-facing responsibilities for running Inkwell (story-editor) on your own infrastructure. Sections marked `[I6]` are stubs to be fleshed out in the I-series (infra tasks) — this file initially exists to satisfy `[E15]`, the key-backup and user-recovery guidance, which must be in place before any public instance is launched.

---

## Key backup and user recovery (`[E15]`)

Inkwell's encryption-at-rest is split across two secret surfaces. They are **not** interchangeable. Back up both, and communicate the user-facing half clearly to your users.

### 1. `APP_ENCRYPTION_KEY` — server-held key (operator's responsibility)

`APP_ENCRYPTION_KEY` is a single 32-byte key loaded from the environment at backend boot. Its **only** job is to wrap the per-user **BYOK Venice API key** (`User.veniceApiKey*` columns). It is **not** used to wrap narrative content — see the content DEK section below.

**Backup requirements:**
- Back up `APP_ENCRYPTION_KEY` with **the same rigour as the Postgres database**. Losing the key means every stored BYOK Venice key on the instance becomes permanently unrecoverable, and every user who had a key stored will be prompted to re-enter it.
- Keep the key **out of Postgres itself** — if a single backup blob carries both the ciphertext and the key, an attacker who gets the backup has full access.
- Treat the key as an offline credential: sealed note in a safe, a hardware token, a password manager's secure-note field. Not on the same disk as the database.
- Rotating `APP_ENCRYPTION_KEY` re-wraps all stored Venice keys; losing the old key mid-rotation is a key-loss event.

**If `APP_ENCRYPTION_KEY` is lost:**
- All stored Venice keys are gone. Users will be asked to re-enter their Venice key on next use.
- **All narrative content remains decryptable** on next login — user narrative is protected by a separate envelope scheme (below) that does not involve this key. This is a deliberate design decision from `[E1]` — narrative security must not depend on server-held state.

### 2. Content DEKs — user-derived keys (user's responsibility)

Each user's narrative content (stories, chapters, characters, outline, chats, messages) is encrypted with a **per-user 32-byte random DEK** that is wrapped **twice**:
- **Password wrap** — argon2id-derived from the user's password.
- **Recovery-code wrap** — argon2id-derived from a one-time recovery code shown **exactly once** at signup.

The server has **no third wrap**. There is no operator-held master key for narrative content. This is intentional:

> **Losing both the password and the recovery code for a given user = irrecoverable data loss for that user's narrative content.**

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

| Secret                 | Held by  | Wraps                         | Loss consequence                                           | Recovery path                                          |
|------------------------|----------|-------------------------------|------------------------------------------------------------|--------------------------------------------------------|
| `APP_ENCRYPTION_KEY`   | Operator | BYOK Venice API keys          | Stored Venice keys lost; users re-enter on next use        | Backup restore; no user-derived alternative            |
| Password               | User     | Content DEK (password wrap)   | DEK accessible via recovery code                           | Recovery code → password reset via `[AU16]`           |
| Recovery code          | User     | Content DEK (recovery wrap)   | DEK accessible via password                                | Rotate via `[AU17]` after login with password          |
| **Password + recovery code (both)** | User | DEK — no third wrap exists  | **Narrative content for that user is permanently lost.**   | **None by design.** Re-create account from scratch.    |

---

## Prerequisites

You'll need:

- A Linux host (or macOS / Windows with WSL2). Tested on Ubuntu 22.04+ and Debian 12.
- **Docker Engine 24+** and **Docker Compose v2+** (`docker compose version`).
- **`git`** to clone the repo.
- **`node` 22+** *only* if you want to run the test suite or `make migrate` from the host. The bundled stack does not require Node on the host.
- A reverse proxy (nginx, Caddy, Traefik, Cloudflare Tunnel) if you intend to expose the instance to the internet — Inkwell does not ship one.
- A small amount of memory: the default stack peaks around ~600 MB RAM under typical load (postgres + node backend + nginx-fronted SPA).

Inkwell uses a **bring-your-own-key (BYOK)** model for AI features — operators do **not** need a Venice.ai account. Each end-user pastes their own Venice API key into Settings on first AI use. The operator's only Venice-related obligation is to back up `APP_ENCRYPTION_KEY`, which wraps those stored user keys (see "Key backup and user recovery" above).

## First-run steps

```bash
# 1. Clone the repo
git clone https://github.com/<your-fork>/story-editor.git
cd story-editor

# 2. Create your .env from the template
cp .env.example .env

# 3. Generate the long-lived secrets the backend requires.
#    JWT_SECRET and REFRESH_TOKEN_SECRET sign access and refresh tokens
#    respectively; APP_ENCRYPTION_KEY is the AES-256 key that wraps stored
#    Venice API keys.
cat <<'KEYGEN' >> /tmp/inkwell-secrets.env
JWT_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))")
REFRESH_TOKEN_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))")
APP_ENCRYPTION_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")
KEYGEN
# Paste those three lines (with the generated values) into .env, replacing the
# placeholder defaults.
#
# Equivalent one-liner if you just want APP_ENCRYPTION_KEY:
#   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"

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

## Updating

```bash
git pull
docker compose build       # rebuilds backend + frontend with the new code
docker compose up -d       # rolling-restart; postgres data persists in pgdata
```

The backend's container entrypoint runs `prisma migrate deploy` on every boot, so a new release that adds migrations applies them automatically. Migrations are designed to be additive (the project uses Prisma's standard "expand-then-contract" pattern); a backup before a major version bump is still recommended — see "Backup and restore" below.

If the release notes say a migration is destructive (e.g. dropping a plaintext column after an encryption rollout), take a `scripts/backup-db.sh` snapshot first and keep it until you've verified the new release end-to-end.

## Backup and restore

Run a regular backup of two things — they are **not** interchangeable:

1. The Postgres database (`pgdata` volume).
2. `APP_ENCRYPTION_KEY` from your `.env` — see "Key backup and user recovery" above for *why* this is separate.

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
