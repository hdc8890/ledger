# Project Status

Single source of truth for where the project stands right now.
Updated at the start/end of each phase or significant milestone.

---

## Current State

**Stage:** Pre-development — planning complete, scaffolding not yet started  
**Active Phase:** None  
**Next Milestone:** Phase 1 scaffold (repo, auth, DB, Plaid ingestion)

---

## Phase Summary

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 1 | Foundation | 🔲 Not started | Plaid, Postgres, sync jobs, auth |
| 2 | Dashboard MVP | 🔲 Not started | Awaits Phase 1 |
| 3 | AI Chat MVP | 🔲 Not started | Awaits Phase 1 |
| 4 | AI Enrichment | 🔲 Not started | Awaits Phase 3 |
| 5 | Memory Layer | 🔲 Not started | Awaits Phase 3 |
| 6 | Goal-Based Planning | 🔲 Not started | Awaits Phase 5 |

Status legend: 🔲 Not started · 🔄 In progress · ✅ Done · 🚧 Blocked

---

## Decisions Locked

These are set. Don't revisit without a strong reason.

- **Stack**: Next.js 15 + TypeScript + Tailwind + Drizzle + Neon + Clerk + Inngest + Vercel AI SDK
- **Primary AI model**: Claude Sonnet (reasoning/tools), `gpt-4o-mini` (enrichment), `text-embedding-3-small` (embeddings)
- **Money representation**: `bigint` cents — never float
- **Write pattern**: AI writes → `pending_changes` → user approval → `audit_events`
- **Memory store**: pgvector on same Neon Postgres — no separate vector DB
- **Out of scope for MVP**: tax optimization, retirement modeling, multi-tenant, native mobile

---

## Open Decisions

Things not yet settled, to be resolved before or during the relevant phase.

| Decision | Needed By | Notes |
|----------|-----------|-------|
| Monorepo vs single Next.js app | Phase 1 start | Single app to start; extract packages when painful (Phase 4 likely) |
| Auth.js vs Clerk | Phase 1 start | Clerk preferred for speed; Auth.js if vendor concern outweighs DX |
| Plaid Sandbox → Production timing | Phase 1 | Apply for Production access early (days of lead time) |
| Category taxonomy (leaf count) | Phase 4 | Start with Plaid PFC, simplify to ~25 leaves |

---

## Blockers

None currently.

---

## How to Update This File

- When starting a phase: change status to 🔄, add a start date note
- When completing a phase: change to ✅, record any scope changes or learnings
- When a decision is made: move it from Open → Locked
- When a blocker appears: add it with owner + date
