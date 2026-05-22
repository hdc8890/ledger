# Ledger — AI Financial Operating System

A personal-first, chat-driven financial OS. Dashboards display state.
A conversational AI agent drives intent. Memory creates personalization.

> "Create a budget that lets us save another $1,500/month"
> "Why did our net worth drop this month?"
> "Costco should mostly count as groceries"

---

## Documentation

### Repo-level (root)
| Doc | Purpose |
|-----|---------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design, data model, request flows, tech stack |
| [`AGENTS.md`](./AGENTS.md) | Coding standards, Git practices, agent operating rules |

### Project state (`docs/`)
| Doc | Purpose |
|-----|---------|
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Product vision, core philosophy, MVP scope |
| [`docs/STATUS.md`](./docs/STATUS.md) | Current phase, decisions locked, open decisions, blockers |
| [`docs/STACK.md`](./docs/STACK.md) | Stack rationale, cross-cutting concerns, what to defer |

### Phase plans (`docs/phases/`)
| Doc | Purpose |
|-----|---------|
| [`phase-1-foundation.md`](./docs/phases/phase-1-foundation.md) | Auth, Plaid, Postgres, sync jobs |
| [`phase-2-dashboards.md`](./docs/phases/phase-2-dashboards.md) | Net worth, cash flow, asset, debt dashboards |
| [`phase-3-ai-chat.md`](./docs/phases/phase-3-ai-chat.md) | Chat UI, tool calling, safe write proposals |
| [`phase-4-enrichment.md`](./docs/phases/phase-4-enrichment.md) | Merchant normalization, categorization, transfer detection |
| [`phase-5-memory.md`](./docs/phases/phase-5-memory.md) | Persistent preferences, household rules, pgvector memory |
| [`phase-6-planning.md`](./docs/phases/phase-6-planning.md) | Goal-based budgets, what-if simulation, progress tracking |

---

## Stack

- **App** — Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- **AI** — Vercel AI SDK · Claude Sonnet · gpt-4o-mini · text-embedding-3-small
- **DB** — Postgres (Neon) + pgvector · Drizzle ORM
- **Auth** — Clerk
- **Jobs** — Inngest
- **Hosting** — Vercel

---

## Roadmap Phases

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Foundation — auth, Plaid, transactions, sync | 🔲 |
| 2 | Dashboard MVP — net worth, cash flow, assets, debt | 🔲 |
| 3 | AI Chat MVP — tool calling, queries, safe edits | 🔲 |
| 4 | AI Enrichment — categorization, merchant normalization, transfers | 🔲 |
| 5 | Memory Layer — preferences, household rules, override persistence | 🔲 |
| 6 | Goal-Based Planning — budgets, forecasts, what-if | 🔲 |

---

## Getting Started

> Setup instructions will be added when Phase 1 scaffolding is complete.

---

## Core Principles

- Dashboards display state — chat drives intent
- Manual overrides always win
- Every AI-written field carries a `source` and `confidence`
- Write proposals require explicit user approval before committing
- Reversibility: every mutation is auditable
