# PatenTrack3

Patent intelligence platform — strategic portfolio oversight.

## Monorepo Structure

```
apps/
  web/              Next.js 15+ (dashboard, admin, share viewer)
  worker/           BullMQ ingestion pipeline

packages/
  db/               Drizzle ORM + PostgreSQL schema
  shared/           Zod schemas, TypeScript types, constants
  business-rules/   Classification engine, broken title detection
  ui/               Shared React components
```

## Quick Start

```bash
# Prerequisites: Node.js 22+, Docker

# 1. Start local databases
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.example .env.local

# 4. Push schema to local database
npm run db:push

# 5. Start development
npm run dev
```

## Commands

| Command | Description |
|---------|------------|
| `npm run dev` | Start all apps in development mode |
| `npm run build` | Build all apps and packages |
| `npm run test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run format` | Format all files with Prettier |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio (database browser) |
| `npm run db:generate` | Generate migration files |
| `npm run db:migrate` | Run pending migrations |

## Documentation

- `docs/analysis/` — Stage A: System analysis (9 documents)
- `docs/design/` — Stage B: Architecture design (6 documents)

## Tech Stack

- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL (Neon) + Drizzle ORM
- **Cache:** Redis (Upstash)
- **Queue:** BullMQ
- **Styling:** Tailwind CSS 4 + Shadcn/ui
- **Testing:** Vitest + Playwright
