# I6 — `SELF_HOSTING.md` complete

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flesh out the four `[I6]`-stub sections in `SELF_HOSTING.md` (Prerequisites, First-run, Updating, Backup and restore) and confirm the port-layout note. Existing `[E15]` content stays. Document the BYOK / no-server-Venice-key model so the operator understands they don't supply a global key.

**Architecture:** Pure documentation. Replace four `*To be detailed in [I6].*` placeholders with actual operator-facing content; everything else in the file stays.

**Prerequisites:** None — `[I1]`–`[I5]` provide the runtime that the doc describes, but the doc can be drafted in parallel and refined as those land. If you write `[I6]` *before* `[I1]`–`[I5]`, references like `make dev` and `bash scripts/backup-db.sh` must still match what the I-tasks plan to ship; cross-check both directions.

**Out of scope:**
- The BYOK env-swap copy itself — that's `[I7]`'s deliverable. `[I6]` references the env vars but `[I7]` is the source of truth for which keys exist.
- Reverse-proxy how-to — out of scope per CLAUDE.md ("the project has no built-in reverse proxy"). One-paragraph note pointing at common options is enough.

**Important caveat — verify-command drift:** The `[I6]` verify currently greps for the literal string `VENICE_API_KEY`:

```
verify: test -f SELF_HOSTING.md && grep -q "docker compose up" SELF_HOSTING.md && grep -q "VENICE_API_KEY" SELF_HOSTING.md
```

…but `[I7]` removes `VENICE_API_KEY` from supporting docs entirely. **Both verifies cannot pass at the same time.** This plan resolves the conflict by:

1. Updating `TASKS.md`'s `[I6]` verify to check for `APP_ENCRYPTION_KEY` instead of `VENICE_API_KEY` (Task 5 below).
2. Mentioning the legacy variable name **only** in a "What changed from older docs" callout, in past-tense, so an operator coming from a stale fork understands.

If you ship `[I6]` before `[I7]`, ship the verify update with it — see Task 5.

---

### Task 1: Fill in the **Prerequisites** section

**Files:**
- Modify: `SELF_HOSTING.md` (replace lines containing `*To be detailed in `[I6]`.*` under `## Prerequisites`)

- [ ] **Step 1: Replace the stub**

```markdown
## Prerequisites

You'll need:

- A Linux host (or macOS / Windows with WSL2). Tested on Ubuntu 22.04+ and Debian 12.
- **Docker Engine 24+** and **Docker Compose v2+** (`docker compose version`).
- **`git`** to clone the repo.
- **`node` 22+** *only* if you want to run the test suite or `make migrate` from the host. The bundled stack does not require Node on the host.
- A reverse proxy (nginx, Caddy, Traefik, Cloudflare Tunnel) if you intend to expose the instance to the internet — Inkwell does not ship one.
- A small amount of memory: the default stack peaks around ~600 MB RAM under typical load (postgres + node backend + nginx-fronted SPA).

Inkwell uses a **bring-your-own-key (BYOK)** model for AI features — operators do **not** need a Venice.ai account. Each end-user pastes their own Venice API key into Settings on first AI use. The operator's only Venice-related obligation is to back up `APP_ENCRYPTION_KEY`, which wraps those stored user keys (see "Key backup and user recovery" above).
```

- [ ] **Step 2: Commit**

```bash
git add SELF_HOSTING.md
git commit -m "[I6] flesh out SELF_HOSTING Prerequisites"
```

---

### Task 2: Fill in **First-run steps**

**Files:**
- Modify: `SELF_HOSTING.md`

- [ ] **Step 1: Replace the stub**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add SELF_HOSTING.md
git commit -m "[I6] add First-run steps walkthrough"
```

---

### Task 3: Fill in **Updating**

**Files:**
- Modify: `SELF_HOSTING.md`

- [ ] **Step 1: Replace the stub**

```markdown
## Updating

```bash
git pull
docker compose build       # rebuilds backend + frontend with the new code
docker compose up -d       # rolling-restart; postgres data persists in pgdata
```

The backend's container entrypoint runs `prisma migrate deploy` on every boot, so a new release that adds migrations applies them automatically. Migrations are designed to be additive (the project uses Prisma's standard "expand-then-contract" pattern); a backup before a major version bump is still recommended — see "Backup and restore" below.

If the release notes say a migration is destructive (e.g. dropping a plaintext column after an encryption rollout), take a `scripts/backup-db.sh` snapshot first and keep it until you've verified the new release end-to-end.
```

- [ ] **Step 2: Commit**

```bash
git add SELF_HOSTING.md
git commit -m "[I6] document update flow"
```

---

### Task 4: Fill in **Backup and restore**

**Files:**
- Modify: `SELF_HOSTING.md`

- [ ] **Step 1: Replace the stub**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add SELF_HOSTING.md
git commit -m "[I6] document backup + restore + off-site rotation"
```

---

### Task 5: Fix the `[I6]` verify command in `TASKS.md`

The current verify greps for `VENICE_API_KEY`, which `[I7]` removes. Update it to check for `APP_ENCRYPTION_KEY` (which the new docs do mention).

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Replace the verify line**

Find (in `TASKS.md`):

```
  - verify: `test -f SELF_HOSTING.md && grep -q "docker compose up" SELF_HOSTING.md && grep -q "VENICE_API_KEY" SELF_HOSTING.md`
```

Replace with:

```
  - verify: `test -f SELF_HOSTING.md && grep -q "docker compose up" SELF_HOSTING.md && grep -q "APP_ENCRYPTION_KEY" SELF_HOSTING.md`
```

- [ ] **Step 2: Commit**

```bash
git add TASKS.md
git commit -m "[I6] fix verify — APP_ENCRYPTION_KEY supersedes VENICE_API_KEY in self-hosting doc"
```

---

### Task 6: Run the (corrected) verify

- [ ] **Step 1: Run via `/task-verify I6`** and only tick on exit 0.
- [ ] **Step 2: Commit the tick**

```bash
git add TASKS.md
git commit -m "[I6] tick — SELF_HOSTING.md complete"
```

---

## Self-Review Notes

- **No reverse-proxy how-to.** A one-line "use whatever you already use" point. Operators on TLS terminate at Caddy / Traefik / Cloudflare Tunnel; documenting one of those would imply we recommend it.
- **`prisma migrate deploy` on boot** is shipped by `[I1]`'s entrypoint, so the docs can promise "schema is created on its own" without asking the operator to run `make migrate`.
- **Recovery-drill text stays in `[E15]` section** — `[I6]` doesn't duplicate it.
- **Verify drift fix** — by updating the verify in this plan, `[I6]` and `[I7]` no longer fight. If `[I7]` is shipped first the corrected verify still passes (it does not touch `VENICE_API_KEY`); if `[I6]` is shipped first the correction is harmless because `APP_ENCRYPTION_KEY` is already in `.env.example`.
- **`VENICE_API_KEY` is not mentioned anywhere in the new copy** — the BYOK callout in Prerequisites is enough.
