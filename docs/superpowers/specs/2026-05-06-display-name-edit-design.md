# Display name: register-time + edit-later — Design

**Issues:** `story-editor-6bw` ([X18] register-time display name) + `story-editor-3xj` ([X3] edit display name in account settings).

**Status:** approved 2026-05-06.

These two bd issues are deliberately bundled into one design / one PR / one `/bd-execute` run. They share the same `User.name` column, the same `nameSchema` validation, and one coherent UX story: a user picks a display name when they register, and can edit it later from the Account & Privacy modal.

## Background

`User.name` is a plaintext nullable column (`name String?`) that the backend register service requires (`nameSchema` in `backend/src/services/auth.service.ts:92`, 1–80 chars). Today, no UI surface lets the user *choose* a display name:

- The register form in `frontend/src/components/AuthForm.tsx` collects only `username` and `password`.
- `frontend/src/hooks/useAuth.ts:108` works around the backend requirement by sending `name: username` — every existing user has `name === username`.
- The `AccountPrivacyModal.tsx` (`[F61]`) covers change-password / rotate-recovery / sign-out-everywhere / delete-account, but has no profile-edit section.
- No backend route mutates `User.name`. `GET /api/auth/me` is the only `/me` endpoint.

So display names are technically supported by the schema but functionally absent from the product.

## Goals

1. Users supply a display name at register time (X18).
2. Users can edit their display name later from Account & Privacy (X3).
3. One consistent validation rule (`nameSchema`, trimmed, 1–80 chars) for register and update.
4. No data-migration branches — existing users keep `name === username` until they edit; both X3 and X18 work cleanly against post-rollout state with no special-casing.

## Non-goals

- Username editing. Username is identity; this design does not touch it.
- Avatars, bios, or any other profile fields. `name` only.
- Encrypting `User.name`. It remains plaintext metadata, consistent with `username` and `email`.
- A separate `/account` page route. The bd issue's `tests/pages/account.test.tsx` verify path predates `[F61]` and is rewritten below.

## Architecture

### Backend

**Shared validation** (`backend/src/services/auth.service.ts`):

```ts
export const nameSchema = z.string().trim().min(1).max(80);
```

Re-export so the new route can import it; the existing register `registerSchema` is updated to use it.

**New service function** in `auth.service.ts`:

```ts
export async function updateProfile(userId: string, name: string): Promise<UserPublic> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name },
    select: { id: true, username: true, name: true, email: true, createdAt: true, updatedAt: true },
  });
  return user;
}
```

Returns the same shape as `GET /api/auth/me`. No transaction needed — single-row write.

**New route** (`backend/src/routes/auth.routes.ts`):

```
POST /api/auth/update-profile
Auth:  requireAuth
Rate:  30 / 15min per userId (relaxed limiter; helpers exist alongside change-password limiter)
Body:  { name: string }              // zod: nameSchema
200:   { user: UserPublic }
400:   { error: { message, code: 'invalid_input', details? } }
401:   { error: { message, code: 'unauthorized' } }
429:   { error: { message, code: 'rate_limited' } }
```

Logging: nothing extra. `name` is plaintext metadata; the existing request logger covers method/path/status.

### Frontend

**`useAuth.ts` — credential type split:**

```ts
export type LoginCredentials    = { username: string; password: string };
export type RegisterCredentials = { name: string; username: string; password: string };

register: useMutation({
  mutationFn: async ({ name, username, password }: RegisterCredentials) =>
    apiPost('/api/auth/register', { name, username, password })  // no defaulting
});
```

The legacy `Credentials` alias is removed; the two callsites (`AuthForm.tsx` for both login + register) update to the appropriate split.

**`AuthForm.tsx` — register variant only:**

- New labelled text input "Display name" placed between username and password.
- `data-testid="register-display-name"`.
- Client-side validation mirrors `nameSchema`: trim, require 1–80 chars. Submit button disabled until valid.
- Login variant unchanged.

**`useAccount.ts` — new mutation:**

```ts
export function useUpdateProfileMutation() {
  const setUser  = useSessionStore((s) => s.setUser);
  const qc       = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiPost('/api/auth/update-profile', { name }) as Promise<{ user: SessionUser }>,
    onSuccess: ({ user }) => {
      setUser(user);
      qc.setQueryData(meQueryKey, { user });
    },
  });
}
```

**`AccountPrivacyModal.tsx` — new first section:**

- Section title: **"Display name"**.
- Single text input pre-filled from `useSessionStore((s) => s.user?.name ?? '')`.
- Save button disabled when (value trimmed) === current name, while pending, or when client-side invalid.
- Inline error/success surfaces: ApiError 400 → field error from zod; 429 → `ERR_RATE`; other → `ERR_GENERIC`. Success: input retains new name, button re-disables (clean state). No toast — quiet-success matches change-password's pattern.
- Existing four sections are pushed down one slot. Section ordering becomes: Display name → Change password → Rotate recovery code → Sign out everywhere → Delete account.

## Data flow

```
User edits "Display name" in modal
    └─▶ useUpdateProfileMutation('newName')
          └─▶ POST /api/auth/update-profile { name: 'newName' }
                └─▶ requireAuth → rate limiter → zod(nameSchema) → updateProfile()
                      └─▶ prisma.user.update({ where:{id:userId}, data:{name} })
                            └─▶ 200 { user: UserPublic }
          ◀── onSuccess({user}) → setUser + setQueryData(meQueryKey)
    ◀── UserMenu / modal re-render with new name
```

Register flow becomes symmetric: form collects `name`, hook sends `{ name, username, password }`, backend's existing register service stores it as-is.

## Validation

Single shared schema, applied identically in register and update:

```ts
nameSchema = z.string().trim().min(1).max(80)
```

- Whitespace-only input fails: `"   "` → trim → `""` → fails `.min(1)`.
- Surrounding whitespace is trimmed: `"  Alice  "` is stored as `"Alice"`.
- Client-side validation in `AuthForm.tsx` and `AccountPrivacyModal.tsx` mirrors the same rule for instant feedback; the server is the source of truth.

## Error handling

- Backend zod failures return the standard `{ error: { message, code: 'invalid_input', details } }` shape used by other auth routes.
- Rate limiter response is the standard `{ error: { code: 'rate_limited' } }` 429 already used by change-password.
- Frontend error mapping matches existing `AccountPrivacyModal` patterns (`ERR_GENERIC`, `ERR_RATE`).

## Testing

### Backend — `backend/tests/auth/update-profile.test.ts` (new)

1. Happy path: 200, response body matches `GET /me` shape, DB row updated.
2. Trim: `"  Alice  "` → stored `"Alice"`.
3. Validation: `""`, `"   "`, 81-char string → 400 `invalid_input`.
4. Auth: missing/expired token → 401.
5. Rate limit: 31st request in 15min → 429.
6. Cross-user isolation: updating user A's name leaves user B's name unchanged.

Lives in `backend/tests/auth/` to match `change-password.test.ts` / `delete-account.test.ts` / `rotate-recovery-code.test.ts`. (The bd verify line's `tests/routes/account.test.ts` path predates `[F61]` and the existing auth-test convention; rewritten in §"Verify lines".)

### Frontend — new test

`frontend/tests/components/AccountPrivacyModal-display-name.test.tsx`:

1. Renders current name in the input (from session store).
2. Save disabled when value === current name.
3. Save disabled when value is whitespace-only.
4. Server 200 → input retains new name, button re-disables, session store has new name.
5. Server 400 → field error renders inline.
6. Server 429 → `ERR_RATE` renders inline.

### Frontend — register-flow updates

- `frontend/tests/components/AuthForm.test.tsx`: register submission now includes the display name field; submit blocked until display name is valid.
- `frontend/tests/hooks/useAuth.test.tsx`: register mutation sends `{ name, username, password }` with `name` from the form (no longer defaulted to `username`).
- `frontend/tests/pages/recovery-code-handoff.test.tsx`: extend setup to fill the display name field on the register form.

## Verify lines

After this design lands, both bd issues' verify lines should be:

- **`story-editor-6bw`** (X18, unchanged shape):
  ```
  cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx tests/hooks/useAuth.test.tsx tests/pages/recovery-code-handoff.test.tsx
  ```
- **`story-editor-3xj`** (X3, rewritten — old `tests/routes/account.test.ts` + `tests/pages/account.test.tsx` predate `[F61]`):
  ```
  cd backend && npm run test:backend -- --run tests/auth/update-profile.test.ts && cd ../frontend && npm run test:frontend -- --run tests/components/AccountPrivacyModal-display-name.test.tsx
  ```

## Migration / rollout

None required. `User.name` already exists; existing users keep `name === username` until they edit. No backfill, no dual-write, no compatibility shims (per the project's no-data-migration-branches rule).

## Reviewer surfaces

- `security-reviewer` is on the path because this touches `auth.routes.ts` and `auth.service.ts`. Scope: confirm `requireAuth` is wired, rate limiter is in place, no plaintext leakage of password/recovery state, response body returns only the `UserPublic` selection.
- `repo-boundary-reviewer` is *not* on the path — `User` is not a narrative entity and `User.name` is plaintext metadata.
- `code-quality-reviewer` is on the path for both stacks via `/bd-execute`.

## Open questions

None at design time.
