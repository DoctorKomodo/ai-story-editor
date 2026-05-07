# Display Name (register + edit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let new users supply a Display name at register time (X18, `story-editor-6bw`) and let existing users edit it later from Account & Privacy (X3, `story-editor-3xj`).

**Architecture:** Add `POST /api/auth/update-profile` (auth-required, per-user rate-limited) returning the same `PublicUser` shape as `GET /me`. Extend the frontend `SessionUser` to include `name`, surface a `setUser` store action, and add a hook + modal section that calls update-profile and writes the response into both the session store and the `/me` query cache. AuthForm's register variant gains a Display name field, and `useAuth.register` stops defaulting `name = username`.

**Tech Stack:** TypeScript strict, Express + Prisma (backend), React + Zustand + TanStack Query + Vite + vitest (frontend), Zod for validation, supertest for backend integration tests.

**Spec:** `docs/superpowers/specs/2026-05-06-display-name-edit-design.md`.

**bd issues:** `story-editor-3xj` + `story-editor-6bw` (bundled, claimed).

---

## File Structure

**Backend**

| File | Responsibility | Action |
|---|---|---|
| `backend/src/services/auth.service.ts` | Existing auth service. Holds `nameSchema` (private) — needs to be exported, plus a new `updateProfile` function. | Modify |
| `backend/src/routes/auth.routes.ts` | Existing auth router. Holds rate-limit constants and route definitions. | Modify (add limiter + route) |
| `backend/tests/auth/update-profile.test.ts` | Integration test for the new route. Mirrors `change-password.test.ts` shape. | Create |

**Frontend**

| File | Responsibility | Action |
|---|---|---|
| `frontend/src/store/session.ts` | Zustand store. Adds `name` to `SessionUser`, adds `setUser` action. | Modify |
| `frontend/src/hooks/useAuth.ts` | Auth hooks. Splits `Credentials` into `LoginCredentials` / `RegisterCredentials`; stops defaulting `name`. | Modify |
| `frontend/src/components/AuthForm.tsx` | Login/register form. Adds Display name field for register variant. | Modify |
| `frontend/src/hooks/useAccount.ts` | Account & Privacy mutations. Adds `useUpdateProfileMutation`. | Modify |
| `frontend/src/components/AccountPrivacyModal.tsx` | Account modal. Inserts new "Display name" section above "Change password". | Modify |
| `frontend/src/pages/EditorPage.tsx` | Reads `username` from session; needs to also read `name` and pass through `<TopBar displayName=…>`. | Modify |
| `frontend/tests/components/AuthForm.test.tsx` | Existing AuthForm test; updated to require Display name in register submissions. | Modify |
| `frontend/tests/hooks/useAuth.test.tsx` | Existing useAuth test; updated to assert register sends user-supplied `name`. | Modify |
| `frontend/tests/pages/recovery-code-handoff.test.tsx` | Existing flow test; updated setup to fill the Display name field. | Modify |
| `frontend/tests/components/AccountPrivacyModal-display-name.test.tsx` | New section's behaviour tests. | Create |

**bd**

| Issue | Action |
|---|---|
| `story-editor-3xj` | Update `verify:` line to point at the real test paths. |
| `story-editor-6bw` | Verify line already correct. No change. |

---

## Pre-flight

Confirm worktree state before starting:

```bash
cd /home/asg/projects/story-editor
git status                         # expect: clean tree on feature/display-name-edit
git log --oneline -1               # expect: ca9118c spec commit on top
bd show story-editor-3xj | head -5 # expect: Owner: DoctorKomodo, in_progress (claimed)
bd show story-editor-6bw | head -5 # expect: Owner: DoctorKomodo, in_progress (claimed)
```

If any of those don't hold, stop and surface the discrepancy before writing code.

---

## Task 1: Backend — `POST /api/auth/update-profile` (TDD)

**Files:**
- Create: `backend/tests/auth/update-profile.test.ts`
- Modify: `backend/src/services/auth.service.ts`
- Modify: `backend/src/routes/auth.routes.ts`

### Steps

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/auth/update-profile.test.ts`:

```typescript
// [X3] POST /api/auth/update-profile — authenticated display-name update.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Original Name';
const NEW_NAME = 'New Display Name';
const USERNAME = 'update-profile-user';
const PASSWORD = 'correct-horse-battery';

async function registerAndLogin(): Promise<{ accessToken: string; userId: string }> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  return {
    accessToken: login.body.accessToken as string,
    userId: login.body.user.id as string,
  };
}

describe('[X3] POST /api/auth/update-profile', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns 401 without a bearer token', async () => {
    const res = await request(app).post('/api/auth/update-profile').send({ name: NEW_NAME });
    expect(res.status).toBe(401);
  });

  it('happy path: 200 with updated user, DB row updated', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: NEW_NAME });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: userId,
      username: USERNAME,
      name: NEW_NAME,
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.name).toBe(NEW_NAME);
  });

  it('trims surrounding whitespace before storing', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '   Trimmed Name   ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Trimmed Name');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.name).toBe('Trimmed Name');
  });

  it('rejects empty name (400 invalid_input)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  it('rejects whitespace-only name (400 invalid_input)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '     ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  it('rejects names longer than 80 chars after trim (400 invalid_input)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'a'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  it('does not affect other users', async () => {
    const a = await registerAndLogin();
    // Second user via a separate username/password — register API is idempotent
    // per username so we reset just the test user above first.
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Second', username: 'second-user', password: PASSWORD });
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ username: 'second-user', password: PASSWORD });
    const bId = loginB.body.user.id as string;

    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ name: NEW_NAME });
    expect(res.status).toBe(200);

    const aRow = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    const bRow = await prisma.user.findUniqueOrThrow({ where: { id: bId } });
    expect(aRow.name).toBe(NEW_NAME);
    expect(bRow.name).toBe('Second');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run test:backend -- --run tests/auth/update-profile.test.ts`
Expected: tests fail because the route doesn't exist (404 / `Cannot POST /api/auth/update-profile`).

- [ ] **Step 3: Export `nameSchema` from the auth service**

In `backend/src/services/auth.service.ts`, change line 92's `const nameSchema = …` to `export const nameSchema = …`. No other changes — `buildRegisterSchema()` keeps using it.

- [ ] **Step 4: Add the `updateProfile` service function**

In `backend/src/services/auth.service.ts`, add to the exported `authService` object (or the equivalent symbol that holds `register`, `login`, `changePassword`, etc. — match the file's existing pattern). Reuse `toPublicUser` so the response shape matches `/me`:

```typescript
async updateProfile({
  userId,
  name,
}: {
  userId: string;
  name: string;
}): Promise<PublicUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name },
  });
  return toPublicUser(user);
},
```

Place it in alphabetical-ish order with the other `authService` methods. If the file binds `authService` as a named-export object, add the new method there; if it uses a class, add it as a method.

> If `authService` is exported as a frozen const, just append to its initialiser. The signature is `updateProfile({ userId, name }: { userId: string; name: string }): Promise<PublicUser>` regardless of binding style.

- [ ] **Step 5: Add the route + per-user limiter**

In `backend/src/routes/auth.routes.ts`:

(a) Import the schema. At the top, change the existing import:

```typescript
import {
  authService,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  REFRESH_TOKEN_TTL_SECONDS,
  UsernameUnavailableError,
  nameSchema,
} from '../services/auth.service';
```

(b) Add a new schema builder function next to the others (after `buildDeleteAccountSchema()`):

```typescript
function buildUpdateProfileSchema() {
  return z.object({ name: nameSchema });
}
```

(c) Add a limiter constant immediately after `const deleteAccountLimiter = …` (still using `SENSITIVE_AUTH_LIMIT_OPTIONS` — display-name updates are not in the same threat class as password ops, but reusing the constant keeps the per-user-keyed pattern consistent and avoids introducing a new tier for one endpoint):

```typescript
const updateProfileLimiter = rateLimit(SENSITIVE_AUTH_LIMIT_OPTIONS);
```

(d) Add the route. Place it just after `router.post('/change-password', …)` (before `sign-out-everywhere`):

```typescript
router.post('/update-profile', requireAuth, updateProfileLimiter, async (req, res, next) => {
  try {
    const authed = req.user;
    if (!authed) {
      res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
      return;
    }
    const parsed = buildUpdateProfileSchema().parse(req.body);
    const user = await authService.updateProfile({
      userId: authed.id,
      name: parsed.name,
    });
    res.status(200).json({ user });
  } catch (err) {
    if (err instanceof ZodError) {
      badRequestFromZod(res, err);
      return;
    }
    next(err);
  }
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npm run test:backend -- --run tests/auth/update-profile.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 7: Run backend typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/auth.service.ts backend/src/routes/auth.routes.ts \
        backend/tests/auth/update-profile.test.ts
git commit -m "[story-editor-3xj] backend: POST /api/auth/update-profile

Adds update-profile route + service fn, exports the existing nameSchema
for reuse, and an integration test covering happy path, trim,
empty/whitespace/over-length validation, missing auth, and cross-user
isolation."
```

---

## Task 2: Frontend — extend `SessionUser` with `name`, add `setUser` action

**Files:**
- Modify: `frontend/src/store/session.ts`

### Steps

- [ ] **Step 1: Extend `SessionUser` and add `setUser` action**

Replace the contents of `frontend/src/store/session.ts` with:

```typescript
import { create } from 'zustand';
import { setAccessToken, setUnauthorizedHandler } from '@/lib/api';

export interface SessionUser {
  id: string;
  username: string;
  name: string;
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  user: SessionUser | null;
  status: SessionStatus;
  setSession: (user: SessionUser, accessToken: string) => void;
  setUser: (user: SessionUser) => void;
  clearSession: () => void;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: 'idle',
  setSession: (user, accessToken) => {
    setAccessToken(accessToken);
    set({ user, status: 'authenticated' });
  },
  setUser: (user) => {
    // Used by mutations that update profile fields (e.g. display name)
    // without rotating the access token. Keeps status === 'authenticated'.
    set({ user });
  },
  clearSession: () => {
    setAccessToken(null);
    set({ user: null, status: 'unauthenticated' });
  },
  setStatus: (status) => set({ status }),
}));

setUnauthorizedHandler(() => {
  useSessionStore.getState().clearSession();
});
```

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: errors in any callsite that constructs a `SessionUser` from a backend response without including `name`. We'll fix those in the next step.

- [ ] **Step 3: Confirm backend already returns `name`**

Backend `/api/auth/login`, `/api/auth/refresh`, `/api/auth/me`, and `/api/auth/register` all already include `name` in the user payload (verified in `backend/src/routes/auth.routes.ts:382-407` and the login/refresh handlers above). No backend change is needed here — the frontend response types just need to widen to accept it.

- [ ] **Step 4: Run frontend typecheck again**

Run: `cd frontend && npm run typecheck`
Expected: any remaining errors are in `useAuth.ts` / `AuthForm.tsx` — those are addressed in Tasks 3, 4, 5.

If errors appear in *other* files (e.g. test fixtures that mock a `SessionUser`), update those fixtures to include `name: 'Some Name'`. Search with: `cd frontend && grep -rn "SessionUser\|setSession" src tests --include='*.ts' --include='*.tsx' | grep -v node_modules`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/session.ts
git commit -m "[story-editor-3xj] frontend: add name to SessionUser, add setUser action"
```

---

## Task 3: Frontend — `useUpdateProfileMutation` hook

**Files:**
- Modify: `frontend/src/hooks/useAccount.ts`

### Steps

- [ ] **Step 1: Add the mutation hook**

Append to `frontend/src/hooks/useAccount.ts` (after `useDeleteAccountMutation`):

```typescript
export interface UpdateProfileInput {
  name: string;
}

export interface UpdateProfileResponse {
  user: SessionUser;
}

/**
 * Update-profile mutation ([X3]). On success, mirrors the returned user
 * into the session store so anywhere that reads from useSessionStore (TopBar,
 * UserMenu, AccountPrivacyModal) re-renders with the new display name. The
 * backend response shape matches GET /api/auth/me so we reuse SessionUser.
 */
export function useUpdateProfileMutation(): UseMutationResult<
  UpdateProfileResponse,
  Error,
  UpdateProfileInput
> {
  const setUser = useSessionStore((s) => s.setUser);
  return useMutation<UpdateProfileResponse, Error, UpdateProfileInput>({
    mutationFn: async (input: UpdateProfileInput): Promise<UpdateProfileResponse> =>
      api<UpdateProfileResponse>('/auth/update-profile', {
        method: 'POST',
        body: input,
      }),
    onSuccess: ({ user }) => {
      setUser(user);
    },
  });
}
```

Add `SessionUser` to the existing `import { useSessionStore }` line:

```typescript
import { type SessionUser, useSessionStore } from '@/store/session';
```

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors in `useAccount.ts` itself. (Lingering errors in other files are addressed in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAccount.ts
git commit -m "[story-editor-3xj] frontend: useUpdateProfileMutation hook"
```

---

## Task 4: Frontend — split `Credentials`, drop `name = username` default

**Files:**
- Modify: `frontend/src/hooks/useAuth.ts`
- Modify: `frontend/tests/hooks/useAuth.test.tsx`

### Steps

- [ ] **Step 1: Update the hook test to assert user-supplied `name`**

Open `frontend/tests/hooks/useAuth.test.tsx` and find the register test. There is currently an assertion that the body sent to `/auth/register` includes `name: <username>`. Replace it with an explicit name distinct from username.

Search the file for `name:` and `register(` to locate the call. The change:

- The test should call `register({ name: 'Display Name', username: 'someuser', password: '...' })`.
- The mock fetch assertion should expect the body to include `name: 'Display Name'`, NOT `name: 'someuser'`.
- If the test imports a `Credentials` type, change the import to `RegisterCredentials` (which Task 4 step 2 introduces).

If the file's existing register test does not pass `name` at all, *add* it to the call site so the type checker forces the new field through.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:frontend -- --run tests/hooks/useAuth.test.tsx`
Expected: the register test fails (either at assertion time, because the mock currently sees `name === username`, or at type-check, because `RegisterCredentials` doesn't exist yet).

- [ ] **Step 3: Split `Credentials` and update `register`**

In `frontend/src/hooks/useAuth.ts`:

(a) Replace lines 5-8:

```typescript
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterCredentials {
  name: string;
  username: string;
  password: string;
}
```

(b) Update the `UseAuthResult` interface (lines 35-42):

```typescript
export interface UseAuthResult {
  user: SessionUser | null;
  status: ReturnType<typeof useSessionStore.getState>['status'];
  login: (creds: LoginCredentials) => Promise<SessionUser>;
  register: (creds: RegisterCredentials) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  resetPassword: (input: ResetPasswordInput) => Promise<void>;
}
```

(c) Update `login` (line 89-99):

```typescript
const login = useCallback(
  async ({ username, password }: LoginCredentials): Promise<SessionUser> => {
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setSession(res.user, res.accessToken);
    return res.user;
  },
  [setSession],
);
```

(d) Replace `register` (line 101-116) — drop the comment block about defaulting and accept the user-supplied `name`:

```typescript
const register = useCallback(
  async ({ name, username, password }: RegisterCredentials): Promise<RegisterResult> => {
    const res = await api<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: { name, username, password },
    });
    return { user: res.user, recoveryCode: res.recoveryCode };
  },
  [],
);
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `cd frontend && npm run test:frontend -- --run tests/hooks/useAuth.test.tsx`
Expected: pass.

- [ ] **Step 5: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: errors in `AuthForm.tsx` — `Credentials` is no longer exported. Those are addressed in Task 5.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useAuth.ts frontend/tests/hooks/useAuth.test.tsx
git commit -m "[story-editor-6bw] frontend: split Credentials, register sends user-supplied name"
```

---

## Task 5: Frontend — Display name field in `AuthForm` (register variant)

**Files:**
- Modify: `frontend/src/components/AuthForm.tsx`
- Modify: `frontend/tests/components/AuthForm.test.tsx`

### Steps

- [ ] **Step 1: Update the AuthForm test for the register variant**

Open `frontend/tests/components/AuthForm.test.tsx`. Add (or extend an existing register test block) the following assertions. The test runner uses `@testing-library/react` + `userEvent`; match the surrounding patterns.

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm } from '@/components/AuthForm';

// Inside `describe('AuthForm register', ...)` — append:

it('register: requires a Display name field', () => {
  render(
    <MemoryRouter>
      <AuthForm mode="register" onSubmit={vi.fn()} />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
});

it('register: blocks submit until display name, username, and password are valid', async () => {
  const onSubmit = vi.fn();
  render(
    <MemoryRouter>
      <AuthForm mode="register" onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  const submit = screen.getByRole('button', { name: /create account/i });
  expect(submit).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/username/i), 'someuser');
  await userEvent.type(screen.getByLabelText(/^password$/i), 'pw-long-enough');
  expect(submit).toBeDisabled(); // still disabled — display name missing

  await userEvent.type(screen.getByLabelText(/display name/i), 'Display Name');
  expect(submit).toBeEnabled();
});

it('register: submits trimmed display name', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <AuthForm mode="register" onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText(/display name/i), '   Trimmed   ');
  await userEvent.type(screen.getByLabelText(/username/i), 'someuser');
  await userEvent.type(screen.getByLabelText(/^password$/i), 'pw-long-enough');
  await userEvent.click(screen.getByRole('button', { name: /create account/i }));
  expect(onSubmit).toHaveBeenCalledWith({
    name: 'Trimmed',
    username: 'someuser',
    password: 'pw-long-enough',
  });
});

it('login: does not render Display name field', () => {
  render(
    <MemoryRouter>
      <AuthForm mode="login" onSubmit={vi.fn()} />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
});
```

If existing register tests in this file destructure `Credentials`, update them to use `RegisterCredentials` for the register-mode tests and `LoginCredentials` for login-mode tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx`
Expected: the new tests fail because the field doesn't exist yet.

- [ ] **Step 3: Update `AuthForm.tsx` — types**

In `frontend/src/components/AuthForm.tsx`:

(a) Replace line 4:

```typescript
import type { LoginCredentials, RegisterCredentials } from '@/hooks/useAuth';
```

(b) Replace lines 9-12 (`AuthFormProps`):

```typescript
type SubmitArg<M extends AuthMode> = M extends 'login' ? LoginCredentials : RegisterCredentials;

export interface AuthFormProps {
  mode: AuthMode;
  onSubmit: (creds: LoginCredentials | RegisterCredentials) => Promise<unknown>;
}
```

> Why the union: the form's `onSubmit` callsite is one of two consumers (`LoginPage`, `RegisterPage`), which already discriminate on mode. Keeping a single union avoids generics in the prop interface and matches the existing pattern.

- [ ] **Step 4: Update `AuthForm.tsx` — add Display name validators and constants**

After line 21 (PASSWORD_ERROR), add:

```typescript
const NAME_MIN = 1;
const NAME_MAX = 80;
const NAME_ERROR = `Display name must be 1–80 characters.`;

function validateName(raw: string): string | null {
  const value = raw.trim();
  if (value.length < NAME_MIN || value.length > NAME_MAX) return NAME_ERROR;
  return null;
}
```

- [ ] **Step 5: Update `AuthForm.tsx` — state, validation, submit**

Inside the component (line 149+), add state for the display name and gate `formInvalid` on it for register mode:

```typescript
const [name, setName] = useState('');
const [nameTouched, setNameTouched] = useState(false);
// ...existing state...

const nameError = validateName(name);
const showNameError = nameTouched && nameError !== null;

const formInvalid =
  (mode === 'register' && nameError !== null) ||
  usernameError !== null ||
  passwordError !== null;
```

Update `handleSubmit` (line 182-197) to include `name` for register:

```typescript
const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
  e.preventDefault();
  if (mode === 'register') setNameTouched(true);
  setUsernameTouched(true);
  setPasswordTouched(true);
  setFormError(null);
  if (formInvalid) return;

  setPending(true);
  try {
    if (mode === 'register') {
      await onSubmit({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        password,
      });
    } else {
      await onSubmit({ username: username.trim().toLowerCase(), password });
    }
  } catch (err) {
    setFormError(mapSubmitError(mode, err));
  } finally {
    setPending(false);
  }
};
```

- [ ] **Step 6: Update `AuthForm.tsx` — render the Display name field**

Insert *before* the existing `<Field label="Username" …>` block (around line 231) and only when `mode === 'register'`:

```tsx
{mode === 'register' ? (
  <Field
    label="Display name"
    hint="Shown in your account menu and AI-prompt header."
    htmlFor="auth-display-name"
  >
    <input
      id="auth-display-name"
      data-testid="register-display-name"
      name="name"
      autoComplete="name"
      value={name}
      aria-invalid={showNameError}
      aria-describedby={showNameError ? 'auth-display-name-error' : undefined}
      onChange={(e) => {
        setName(e.target.value);
        if (formError) setFormError(null);
      }}
      onBlur={() => {
        setNameTouched(true);
      }}
      className={INPUT_CLASS}
    />
    {showNameError ? (
      <span id="auth-display-name-error" className="text-[12px] text-[var(--danger)] mt-0.5">
        {nameError}
      </span>
    ) : null}
  </Field>
) : null}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx`
Expected: pass.

- [ ] **Step 8: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: any remaining errors in `RegisterPage.tsx` / `LoginPage.tsx`. Resolve them by updating the page-level handlers to use the discriminated union — RegisterPage already calls `register(creds)` and the union widens the callsite, so most likely no change is needed. If a callsite explicitly types `creds: Credentials`, change to `RegisterCredentials` or `LoginCredentials` as appropriate.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/AuthForm.tsx frontend/tests/components/AuthForm.test.tsx \
        frontend/src/pages/RegisterPage.tsx frontend/src/pages/LoginPage.tsx
git commit -m "[story-editor-6bw] frontend: Display name field in AuthForm register variant"
```

(Stage `RegisterPage.tsx` / `LoginPage.tsx` only if the typecheck above forced an edit.)

---

## Task 6: Frontend — fix the recovery-code-handoff test setup

**Files:**
- Modify: `frontend/tests/pages/recovery-code-handoff.test.tsx`

### Steps

- [ ] **Step 1: Run the test to confirm it currently fails**

Run: `cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx`
Expected: failure — the form's submit button is now disabled because the test never fills the new Display name field.

- [ ] **Step 2: Update the test setup**

Open `frontend/tests/pages/recovery-code-handoff.test.tsx`. Find the section that fills the register form (look for `getByLabelText(/username/i)` or `userEvent.type(... 'username')`). Insert a `userEvent.type(screen.getByLabelText(/display name/i), 'Test User');` line before username/password are typed.

If the test has helper like `fillRegisterForm()`, update it inside the helper.

- [ ] **Step 3: Run the test again to verify it passes**

Run: `cd frontend && npm run test:frontend -- --run tests/pages/recovery-code-handoff.test.tsx`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/pages/recovery-code-handoff.test.tsx
git commit -m "[story-editor-6bw] frontend: fill Display name in recovery-code-handoff test setup"
```

---

## Task 7: Frontend — Display name section in AccountPrivacyModal (TDD)

**Files:**
- Create: `frontend/tests/components/AccountPrivacyModal-display-name.test.tsx`
- Modify: `frontend/src/components/AccountPrivacyModal.tsx`

### Steps

- [ ] **Step 1: Write the failing test file**

Create `frontend/tests/components/AccountPrivacyModal-display-name.test.tsx`:

```typescript
// [X3] AccountPrivacyModal "Display name" section — render, edit, save,
// success, validation, rate-limit. Mirrors the patterns used in the
// existing AccountPrivacyModal*.test.tsx files in this folder.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPrivacyModal } from '@/components/AccountPrivacyModal';
import { useSessionStore } from '@/store/session';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSessionStore.setState({
    user: { id: 'u1', username: 'someuser', name: 'Original Name' },
    status: 'authenticated',
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useSessionStore.setState({ user: null, status: 'idle' });
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPrivacyModal open onClose={vi.fn()} username="someuser" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountPrivacyModal — Display name section', () => {
  it('renders the current display name from the session store', () => {
    renderModal();
    const input = screen.getByLabelText(/display name/i) as HTMLInputElement;
    expect(input.value).toBe('Original Name');
  });

  it('disables Save until the value is dirty and valid', async () => {
    renderModal();
    const save = screen.getByRole('button', { name: /save display name/i });
    expect(save).toBeDisabled(); // not dirty

    const input = screen.getByLabelText(/display name/i);
    await userEvent.clear(input);
    await userEvent.type(input, '   '); // whitespace-only
    expect(save).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    expect(save).toBeEnabled();
  });

  it('on success: posts trimmed name, updates session store, re-disables Save', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ user: { id: 'u1', username: 'someuser', name: 'New Name' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderModal();
    const input = screen.getByLabelText(/display name/i);
    await userEvent.clear(input);
    await userEvent.type(input, '   New Name   ');
    await userEvent.click(screen.getByRole('button', { name: /save display name/i }));

    await waitFor(() => {
      expect(useSessionStore.getState().user?.name).toBe('New Name');
    });
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({ name: 'New Name' });
    expect(screen.getByRole('button', { name: /save display name/i })).toBeDisabled();
  });

  it('on 400: shows inline validation error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Name too long', code: 'invalid_input' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderModal();
    const input = screen.getByLabelText(/display name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'X');
    await userEvent.click(screen.getByRole('button', { name: /save display name/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('on 429: shows rate-limit error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Too many requests', code: 'rate_limited' } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderModal();
    const input = screen.getByLabelText(/display name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'X');
    await userEvent.click(screen.getByRole('button', { name: /save display name/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacyModal-display-name.test.tsx`
Expected: failure — `getByLabelText(/display name/i)` and `getByRole('button', { name: /save display name/i })` don't exist yet.

- [ ] **Step 3: Add the section component to `AccountPrivacyModal.tsx`**

(a) Add the import for the new mutation. Update the existing import:

```typescript
import {
  type ChangePasswordInput,
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useRotateRecoveryCodeMutation,
  useSignOutEverywhereMutation,
  useUpdateProfileMutation,
} from '@/hooks/useAccount';
```

Add a session store import at the top of the file (near the other imports):

```typescript
import { useSessionStore } from '@/store/session';
```

(b) Add a new section component just above `ChangePasswordSection` (around line 113):

```tsx
// ---------- Section 0: Display name ([X3]) ----------
function DisplayNameSection(): JSX.Element {
  const inputId = useId();
  const currentName = useSessionStore((s) => s.user?.name ?? '');

  const [name, setName] = useState(currentName);
  const [err, setErr] = useState<string | null>(null);
  const mutation = useUpdateProfileMutation();

  // Re-sync local input if the session store updates from elsewhere
  // (e.g. another tab via /me query refresh).
  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  const trimmed = name.trim();
  const tooShort = trimmed.length === 0;
  const tooLong = trimmed.length > 80;
  const dirty = trimmed !== currentName;
  const submitDisabled = !dirty || tooShort || tooLong || mutation.isPending;

  const submit = async (): Promise<void> => {
    setErr(null);
    if (submitDisabled) return;
    try {
      await mutation.mutateAsync({ name: trimmed });
      // session store updated by the mutation's onSuccess; local input
      // reconciles via the useEffect above.
    } catch (e) {
      setErr(mapApiError(e, ERR_GENERIC));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={inputId} className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-[var(--ink-2)]">Display name</span>
        <input
          id={inputId}
          type="text"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (err) setErr(null);
          }}
          aria-invalid={tooLong}
          className={INPUT_CLASS}
        />
        {tooLong ? (
          <span className="text-[12px] text-[var(--danger)]">
            Display name must be 1–80 characters.
          </span>
        ) : null}
      </label>

      {err ? (
        <div role="alert" className="auth-error">
          {err}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Save display name"
          disabled={submitDisabled}
          onClick={() => {
            void submit();
          }}
          className={BTN_PRIMARY}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

Add `useEffect` to the existing `react` import at line 27:

```typescript
import { useEffect, useId, useState } from 'react';
```

(c) Insert the section in the modal body, **before** the Change password section (line 526):

```tsx
<Section
  title="Display name"
  hint="Shown in your account menu and the AI prompt header. Visible only to you."
>
  <DisplayNameSection />
</Section>
<Section
  title="Change password"
  hint="Use your current password to set a new one. Other sessions will be signed out."
>
  <ChangePasswordSection />
</Section>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacyModal-display-name.test.tsx`
Expected: pass.

- [ ] **Step 5: Re-run the full AccountPrivacyModal test suite**

Run: `cd frontend && npm run test:frontend -- --run tests/components/AccountPrivacyModal`
Expected: all the existing AccountPrivacyModal tests still pass — no regressions from inserting the new section.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AccountPrivacyModal.tsx \
        frontend/tests/components/AccountPrivacyModal-display-name.test.tsx
git commit -m "[story-editor-3xj] frontend: Display name section in AccountPrivacyModal"
```

---

## Task 8: Frontend — wire `displayName` through TopBar in EditorPage

**Files:**
- Modify: `frontend/src/pages/EditorPage.tsx`

### Steps

- [ ] **Step 1: Pass `displayName` from session to TopBar**

In `frontend/src/pages/EditorPage.tsx` line 111, beside the existing `username` selector, add:

```typescript
const username = useSessionStore((s) => s.user?.username) ?? '';
const displayName = useSessionStore((s) => s.user?.name) ?? null;
```

Find the two `<TopBar … />` and `<UserMenu … />` callsites at line 556 and 749 and add `displayName={displayName}` next to the existing `username={username}` prop. (TopBar already accepts `displayName?: string | null` per `TopBar.tsx:40`; UserMenu the same per `UserMenu.tsx:31`.)

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: pass.

- [ ] **Step 3: Run the full frontend test suite for the touched files**

Run:
```bash
cd frontend && npm run test:frontend -- --run \
  tests/components/AuthForm.test.tsx \
  tests/hooks/useAuth.test.tsx \
  tests/pages/recovery-code-handoff.test.tsx \
  tests/components/AccountPrivacyModal-display-name.test.tsx \
  tests/components/AccountPrivacyModal
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx
git commit -m "[story-editor-3xj] frontend: pipe display name to TopBar/UserMenu"
```

---

## Task 9: Update bd verify lines + final gates

**Files:**
- bd issue notes: `story-editor-3xj` (verify line), `story-editor-6bw` (no change)

### Steps

- [ ] **Step 1: Rewrite `story-editor-3xj` verify line**

The original verify line (`tests/routes/account.test.ts && tests/pages/account.test.tsx`) doesn't match the spec's chosen test paths. Rewrite via `bd update`:

```bash
bd update story-editor-3xj --notes "$(cat <<'EOF'
plan: docs/superpowers/plans/2026-05-06-display-name-edit.md
verify: cd backend && npm run test:backend -- --run tests/auth/update-profile.test.ts && cd ../frontend && npm run test:frontend -- --run tests/components/AccountPrivacyModal-display-name.test.tsx
ref: TASKS.md [X3] (bundled with [X18])
EOF
)"
```

- [ ] **Step 2: Confirm `story-editor-6bw` verify line is unchanged**

Run `bd show story-editor-6bw` and confirm `verify:` is:

```
cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx tests/hooks/useAuth.test.tsx tests/pages/recovery-code-handoff.test.tsx
```

If the existing notes lack a `plan:` line, add one:

```bash
bd update story-editor-6bw --notes "$(cat <<'EOF'
plan: docs/superpowers/plans/2026-05-06-display-name-edit.md
verify: cd frontend && npm run test:frontend -- --run tests/components/AuthForm.test.tsx tests/hooks/useAuth.test.tsx tests/pages/recovery-code-handoff.test.tsx
ref: TASKS.md [X18] (bundled with [X3])
EOF
)"
```

- [ ] **Step 3: Run both verify lines as a final gate**

```bash
bash .claude/skills/task-verify/run.sh story-editor-3xj
bash .claude/skills/task-verify/run.sh story-editor-6bw
```

Both must exit 0.

- [ ] **Step 4: Run the full backend + frontend typecheck**

```bash
cd backend && npm run typecheck && cd ../frontend && npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit the bd notes export**

```bash
git add .beads/issues.jsonl
git commit -m "[story-editor-3xj][story-editor-6bw] update bd verify lines + plan link"
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feature/display-name-edit
```

- [ ] **Step 7: Hand off to `/bd-close-reviewed`**

`/bd-execute` runs `/bd-close-reviewed` automatically at end-of-loop. If executed manually, run:

```bash
/bd-close-reviewed story-editor-3xj
/bd-close-reviewed story-editor-6bw
```

Each will: run the verify, fan out path-matched surface reviewers (`security-reviewer` is on the path because we touched `auth.routes.ts` + `auth.service.ts`), and only close on CLEAN. `BLOCK` / `FIX_BEFORE_MERGE` requires `--override-block "<reason>"` with user ack.

---

## Self-review notes

- **Spec coverage:** Every section of the spec maps to a task: register-flow validation → Tasks 4 + 5 + 6; backend route → Task 1; modal section → Task 7; session/cache wiring → Tasks 2 + 3 + 8; verify-line rewrites → Task 9.
- **TDD discipline:** Each task that introduces behaviour writes the failing test first, runs it to confirm failure, then implements. Tasks 2, 3, 8 are pure plumbing with no behaviour change — typecheck is the gate.
- **No placeholders:** every code block is concrete and copy-pasteable.
- **Cross-task type consistency:** `SessionUser`, `LoginCredentials`, `RegisterCredentials`, `UpdateProfileInput`, `UpdateProfileResponse` all flow through unchanged from where they're defined.
- **Reviewer surfaces:** security-reviewer (auth route + service), code-quality-reviewer (both stacks). repo-boundary-reviewer is *not* on the path — `User` isn't a narrative entity.
