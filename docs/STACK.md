# Tech Stack

Rationale and cross-cutting engineering decisions for the AI Financial
Operating System. For per-phase build plans see `docs/phases/`. For
system design see `ARCHITECTURE.md`.

---

## Guiding Principles

1. **Single-developer velocity.** Managed services and well-trodden
   tools over bespoke infra.
2. **Type safety end-to-end.** Schema → DB → API → UI in one language
   (TypeScript). No generated bridge layers.
3. **AI-native ergonomics.** Tool calling, streaming, and embeddings
   are first-class, not bolted on.
4. **Personal-first, not multi-tenant-first.** Build for one household.
   Model `household_id` now so multi-tenant is a future migration, not
   a rewrite.
5. **Manual override always wins.** Every AI write must be reversible
   and attributable: `source` + `confidence` + `timestamp` + `actor`.

---

## Stack Choices

### Frontend
| Concern | Choice |
|---------|--------|
| App framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Client data | TanStack Query (non-RSC interactivity only) |
| Charts | Recharts |
| AI / chat | Vercel AI SDK (`ai` + `@ai-sdk/react`) |

### Backend
| Concern | Choice |
|---------|--------|
| API layer | Next.js Route Handlers + Server Actions |
| Validation | Zod (same schema drives LLM tool definitions) |
| Optional RPC | tRPC — skip until Server Actions feel insufficient |

### Data
| Concern | Choice |
|---------|--------|
| Database | Postgres on **Neon** (serverless, branching) |
| Vector store | **pgvector** extension on same Neon DB |
| ORM | **Drizzle ORM** + Drizzle Kit migrations |

Drizzle over Prisma because finance queries are SQL-shaped (CTEs,
window functions, aggregations). SQL transparency matters here.

### Auth
**Clerk** — social + magic links, trivial Next.js integration.
Alternative: Auth.js if you want no vendor dependency.

### AI
| Concern | Choice |
|---------|--------|
| Orchestration | Vercel AI SDK (provider-agnostic) |
| Reasoning + tools | Anthropic Claude Sonnet |
| Cheap classification | OpenAI `gpt-4o-mini` |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| Memory | Postgres + pgvector — no Pinecone/Mem0 needed yet |
| Agent framework | None — plain TS tool functions. Revisit if multi-step planning requires it |

### Background Jobs
**Inngest** — durable, observable, generous free tier.
Used for: Plaid sync, enrichment fan-out, nightly snapshots,
webhook handlers, scheduled re-categorization.
Alternative: Trigger.dev (same shape).

### External Integrations
| Service | Notes |
|---------|-------|
| Plaid | Official `plaid` Node SDK — Link + Transactions Sync + Investments + Liabilities |
| Property valuation | Defer. Manual value + appreciation curve until Phase 2+; then RentCast or HouseCanary |
| Vehicle valuation | Defer. Manual + linear depreciation until enrichment matters; then VINData / MarketCheck |

### Infra & Ops
| Concern | Choice |
|---------|--------|
| Hosting | Vercel |
| Database | Neon |
| Jobs | Inngest Cloud |
| Errors + perf | Sentry |
| Secrets | Vercel env vars (never committed) |
| Analytics | PostHog — low priority for personal-first |

---

## Why Not the Alternatives

- **FastAPI / Python backend** — splits the stack, loses shared types.
  Python's AI ecosystem advantage is small when Vercel AI SDK +
  Anthropic/OpenAI TS SDKs are excellent.
- **Prisma** — works, but Drizzle's SQL transparency wins for
  finance-heavy queries.
- **Supabase end-to-end** — fine if you want RLS + PostgREST. Neon +
  Clerk + Drizzle gives more control at the same cost.
- **LangGraph / LangChain** — complexity without payoff at this scale.
  Revisit only if multi-step agent planning becomes unwieldy.

---

## Cross-Cutting Concerns

These aren't a phase — they're foundations wired through Phase 1 and
respected by every phase after.

| Concern | Rule |
|---------|------|
| **Money** | `bigint` cents everywhere. Never `float`. Helpers in `packages/shared/money.ts` |
| **Time** | Store UTC `timestamptz`. Render in user TZ with `date-fns-tz` |
| **Idempotency** | Every Plaid sync, AI write, and import keyed on a stable external ID |
| **Audit log** | `audit_events(actor, action, entity, before, after, source, confidence, at)` — AI writes always emit |
| **Confidence + source** | Every enriched field: `source ∈ {plaid, ai, user, rule}`, `confidence ∈ [0,1]` |
| **Feature flags** | `users.settings.flags` jsonb — no third-party flag service |
| **Secrets** | Plaid access tokens encrypted at rest. No credentials in the repo |

---

## Build Order Micro-Loop (every phase)

Follow this order for every new feature within a phase:

1. **Schema + migration** (Drizzle)
2. **Repository function** (typed query in `packages/db/queries/`) with unit test on a seeded DB
3. **Tool / route handler** with Zod validation
4. **UI** — RSC for reads, Server Action for writes
5. **Audit + telemetry** — `audit_events` row, Sentry breadcrumb, LLM cost log
6. **Manual override path** verified before marking done

---

## What to Defer

Revisit these only after Phase 6 stabilizes:

- Multi-user households (schema carries `household_id` today — activation is mechanical)
- Mobile native app (PWA is enough at this stage)
- Real-time streaming syncs (webhooks + cron cover it)
- Investment lot-level cost basis and tax (Phase 7+)
- Property / vehicle valuation API calls (manual override is fine until then)
- Complex forecasting, retirement modeling, predictive trading
