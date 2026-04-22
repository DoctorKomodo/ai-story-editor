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

## Prerequisites (`[I6]` stub)

*To be detailed in `[I6]`.* Target: Docker-capable host, Postgres reachable, `APP_ENCRYPTION_KEY` + JWT/refresh secrets provisioned.

## First-run steps (`[I6]` stub)

*To be detailed in `[I6]`.*

## Updating (`[I6]` stub)

*To be detailed in `[I6]`.*

## Backup and restore (`[I6]` stub)

*To be detailed in `[I6]`.* See "Key backup and user recovery" above — `APP_ENCRYPTION_KEY` must be part of the backup plan.

## Port layout (`[I6]` stub)

Frontend: `:3000`. Backend: `:4000`. No built-in reverse proxy — an operator-supplied upstream (nginx, Caddy, Traefik, Cloudflare Tunnel) is expected. Detailed config in `[I6]`.
