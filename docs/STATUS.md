# Project Status

Single source of truth for where the project stands right now.
Updated at the start/end of each phase or significant milestone.

---

## Current State

**Stage:** Active development — Phase 3 in progress  
**Active Phase:** Phase 3 — AI Chat MVP  
**Last Completed:** Phase 2 — Dashboard MVP (all 7 tasks ✅)  
**Current Task:** Phase 3 Task 5 — Chat history persistence

---

## Phase Summary

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 1 | Foundation | ✅ Done | All 6 tasks complete |
| 2 | Dashboard MVP | ✅ Done | All 7 tasks complete — 4 dashboards, empty states, skeletons, RSC-first, coverage ≥70% |
| 3 | AI Chat MVP | 🔄 In progress | Tasks 1–4 ✅ (chat route + streaming UI, tool registry 10 tools, write-tool safety pattern); Task 5 next |
| 4 | AI Enrichment | 🔲 Not started | Awaits Phase 3 |
| 5 | Memory Layer | 🔲 Not started | Awaits Phase 3 |
| 6 | Goal-Based Planning | 🔲 Not started | Awaits Phase 5 |

Status legend: 🔲 Not started · 🔄 In progress · ✅ Done · 🚧 Blocked

---

## Decisions Locked

These are set. Don't revisit without a strong reason.

- **Monorepo vs single Next.js app**: pnpm workspace active now; `apps/web/` holds all Phase 1–3 code; additional `packages/` extracted at Phase 4
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
| Auth.js vs Clerk | Phase 1 Task 2 | ~~Clerk preferred for speed; Auth.js if vendor concern outweighs DX~~ **Resolved: Clerk** |
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
