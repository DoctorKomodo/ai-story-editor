# Story Editor

A self-hosted, web-based story and text editor with Venice.ai AI integration. Users can manage multiple stories, break them into chapters, attach characters for consistency, and invoke AI assistance directly from a TipTap rich text editor.

## Monorepo layout

```
/
├── frontend/   React + Vite + TypeScript + TailwindCSS + TipTap
├── backend/    Node.js + Express + TypeScript + Prisma
├── db/         Prisma schema and migrations
├── scripts/    Utility shell scripts (backup, seed, reset)
├── docs/       Architecture and API documentation
└── docker-compose.yml
```

## Quick start

1. Copy `.env.example` to `.env` and fill in values (including your Venice.ai API key).
2. `docker compose up -d`
3. Frontend: http://localhost:3000 — Backend: http://localhost:4000

See [SELF_HOSTING.md](SELF_HOSTING.md) for production deployment instructions.

## Development

Source of truth for development work is [TASKS.md](TASKS.md). Operating rules for contributors (including Claude Code) are in [CLAUDE.md](CLAUDE.md).
