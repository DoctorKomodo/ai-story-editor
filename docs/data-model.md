# Data Model

Authoritative reference for the Prisma schema ([backend/prisma/schema.prisma](../backend/prisma/schema.prisma)). Field types match the schema exactly; review this doc whenever the schema changes. Encrypted-at-rest columns described here are the **plaintext columns** that exist today — the ciphertext triples from the E-series will be added additively and documented in [encryption.md](./encryption.md).

---

## Entity Relationship Diagram

```mermaid
erDiagram
    User ||--o{ Story : owns
    User ||--o{ RefreshToken : issues
    Story ||--o{ Chapter : contains
    Story ||--o{ Character : casts
    Story ||--o{ OutlineItem : structures
    Chapter ||--o{ Chat : hosts
    Chat ||--o{ Message : logs

    User {
        string  id PK
        string  email UK "nullable — metadata only"
        string  username UK "3-32 chars, /^[a-z0-9_-]+$/"
        string  name
        string  passwordHash
        json    settingsJson "theme / prose / writing / daily goal / chat params"
        string  veniceApiKeyEnc "BYOK ciphertext (AES-256-GCM, base64)"
        string  veniceApiKeyIv "12-byte IV, base64"
        string  veniceApiKeyAuthTag "GCM tag, base64"
        string  veniceEndpoint "default https://api.venice.ai/api/v1"
        date    createdAt
        date    updatedAt
    }
    Story {
        string  id PK
        string  userId FK
        string  title
        string  synopsis
        string  genre
        string  worldNotes
        int     targetWords "e.g. 90000 — sidebar progress target"
        string  systemPrompt "per-story creative-writing system prompt"
        date    createdAt
        date    updatedAt
    }
    Chapter {
        string  id PK
        string  storyId FK
        string  title
        string  content "plaintext mirror derived from bodyJson"
        json    bodyJson "TipTap JSON — canonical"
        string  status "draft / revised / final"
        int     orderIndex
        int     wordCount
        date    createdAt
        date    updatedAt
    }
    Character {
        string  id PK
        string  storyId FK
        string  name
        string  role
        string  age
        string  appearance
        string  voice
        string  arc
        string  initial "1-char sidebar avatar letter"
        string  color "avatar background hex"
        string  physicalDescription
        string  personality
        string  backstory
        string  notes
        date    createdAt
        date    updatedAt
    }
    OutlineItem {
        string  id PK
        string  storyId FK
        int     order
        string  title
        string  sub
        string  status "done / current / pending"
        date    createdAt
        date    updatedAt
    }
    Chat {
        string  id PK
        string  chapterId FK
        string  title
        date    createdAt
        date    updatedAt
    }
    Message {
        string  id PK
        string  chatId FK
        string  role "user / assistant / system"
        json    contentJson
        json    attachmentJson "{ selectionText, chapterId }"
        string  model
        int     tokens
        int     latencyMs
        date    createdAt
    }
    RefreshToken {
        string  id PK
        string  userId FK
        string  token UK
        date    expiresAt
        date    createdAt
    }
```

---

## Relationships & Cascade Behaviour

| Parent → Child | FK | Cascade | Rationale |
|---|---|---|---|
| User → Story | `Story.userId` | `onDelete: Cascade` | Account delete removes all user-owned writing. |
| User → RefreshToken | `RefreshToken.userId` | `onDelete: Cascade` | Session records vanish with the account. |
| Story → Chapter | `Chapter.storyId` | `onDelete: Cascade` | A story has no meaning without its chapters. |
| Story → Character | `Character.storyId` | `onDelete: Cascade` | Characters are scoped to a single story. |
| Story → OutlineItem | `OutlineItem.storyId` | `onDelete: Cascade` | Outline lives inside the story it belongs to. |
| Chapter → Chat | `Chat.chapterId` | `onDelete: Cascade` | Chats are bound to the chapter they were opened from. |
| Chat → Message | `Message.chatId` | `onDelete: Cascade` | Messages can't outlive their chat. |

---

## Indexes

| Table | Index | Purpose |
|---|---|---|
| User | `email` unique, `username` unique | Login lookup; uniqueness enforcement. |
| Story | `(userId)` | List-stories-for-user is the hot path. |
| Chapter | `(storyId)`, `(storyId, orderIndex)` | List chapters; ordered render without a sort. |
| Character | `(storyId)` | Sidebar cast + prompt-builder fetch. |
| OutlineItem | `(storyId)`, `(storyId, order)` | Outline sidebar + drag-reorder. |
| Chat | `(chapterId)` | List chats for the open chapter. |
| Message | `(chatId)`, `(chatId, createdAt)` | Chronological log render. |
| RefreshToken | `token` unique, `(userId)` | Cookie lookup + per-user revocation. |

---

## Field Conventions

- **IDs** are CUIDs (`String @id @default(cuid())`), never incrementing integers, so they're safe to expose in URLs.
- **Timestamps** — every narrative model has `createdAt` + `updatedAt`. `Message` is append-only (`createdAt` only).
- **JSON columns** (`Chapter.bodyJson`, `User.settingsJson`, `Message.contentJson`, `Message.attachmentJson`) are Postgres `JSONB`; Prisma types them as `Prisma.JsonValue` / `Prisma.InputJsonValue`.
- **Nullable vs required** — narrative prose fields (`synopsis`, `notes`, etc.) are nullable; structural fields (FKs, `orderIndex`, `status` with a default) are required.
- **Status enums are strings**, not Prisma enums, so the UI can add new states (`Chapter.status`, `OutlineItem.status`, `Message.role`) without a migration.

---

## Derived Fields

- `Chapter.wordCount` — computed from `bodyJson` in backend code before write ([B10]). Never derived at read time; never derived from ciphertext once [E5] lands.
- `Story` progress (`X / Y words · Z%`) — computed on demand in `GET /api/stories/:id/progress` ([B9]).

---

## Encryption Surface (Preview — E-series)

Narrative text columns listed above will gain `*Ciphertext / *Iv / *AuthTag` siblings during the E-series. Plaintext mirrors stay in place during dual-write rollout ([E4]–[E8]) and are dropped in [E11]. `Chapter.content` is intentionally dropped — TipTap JSON decrypted via the chapter repo becomes the sole source of truth. Full column-by-column list and the KEK / DEK model live in [encryption.md](./encryption.md).
