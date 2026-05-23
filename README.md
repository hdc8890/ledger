# Ledger

A personal AI financial operating system. Instead of manually maintaining
dashboards and budgets, you talk to an agent that understands your money.

> **"Create a budget that lets us save another $1,500/month"**
> → Analyzes your income, recurring bills, and spending trends. Returns
> a concrete plan for your approval.

> **"Why did our net worth drop this month?"**
> → Traces the delta across accounts, assets, and liabilities. Explains
> the actual cause.

> **"Costco should mostly count as groceries"**
> → Remembered. Applied to past and future transactions.

Dashboards exist — but they're passive views. The agent is the
primary interface.

---

## How it works

```
Your banks (via Plaid) → normalized transaction data
                              ↓
                     AI enrichment layer
               (categorization, merchant normalization,
                transfer detection, recurring bills)
                              ↓
              Conversational agent with financial tools
               (query, summarize, plan, edit, remember)
                              ↓
                    Chat  ·  Dashboards  ·  Goals
```

---

## Stack

- **App** — Next.js 15 · TypeScript · Tailwind · shadcn/ui
- **AI** — Vercel AI SDK · Claude Sonnet · GPT-4o-mini · pgvector memory
- **Data** — Postgres on Neon · Drizzle ORM · Plaid
- **Jobs** — Inngest
- **Auth** — Clerk
- **Hosting** — Vercel

---

## Status

Early development. See [`docs/STATUS.md`](./docs/STATUS.md) for current
phase and progress.

---

## Getting Started

> Setup instructions will be added when Phase 1 scaffolding is complete.

---

## Development

```bash
pnpm install          # install workspace deps
pnpm dev              # run the web app (apps/web) in dev mode
pnpm build            # production build
pnpm typecheck        # strict TypeScript check
pnpm lint             # ESLint
pnpm test             # run the Vitest suite once
pnpm test:watch       # Vitest in watch mode
pnpm test:coverage    # Vitest + v8 coverage report (apps/web/coverage)
```

Tests live next to the code they cover, in `__tests__/`
directories (`*.test.ts` / `*.test.tsx`). Coverage is enforced
at 70% lines / functions / branches / statements — see
`AGENTS.md` §5 for testing conventions.

---

## Learn more

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design, data model, request flows
- [`docs/`](./docs/) — roadmap, stack decisions, and phase plans
