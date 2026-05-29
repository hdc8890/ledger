# Project Status

Single source of truth for where the project stands right now.
Updated at the start/end of each phase or significant milestone.

---

## Current State

**Stage:** Active development — Phase 8 complete  
**Active Phase:** Phase 8 — Auth.js Migration (**complete**)  
**Last Completed:** Phase 8 — Auth.js Migration  
**Next Phase:** TBD — MVP feature phases (1–8) complete

---

## Phase Summary

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 1 | Foundation | ✅ Done | All 6 tasks complete |
| 2 | Dashboard MVP | ✅ Done | All 7 tasks complete — 4 dashboards, empty states, skeletons, RSC-first, coverage ≥70% |
| 3 | AI Chat MVP | ✅ Done | All 8 tasks complete — streaming chat, 10 tools, write-tool safety, conversation persistence, cost logging, rate limiting |
| 4 | AI Enrichment | ✅ Done | All 7 tasks complete — merchant normalization, category inference, transfer detection, recurring bill detection, historical backfill, correction UI (/transactions page + CategoryChip + correctCategoryAction + categorization rules + retag), dashboard query transfer exclusion confirmed |
| 5 | Memory Layer | ✅ Done | All 7 tasks complete — pgvector schema, AI memory helper, agent tools (save/delete/list/retrieve), system prompt injection, auto-extraction Inngest job + "Remember: X?" UI chip, override persistence (correctCategoryAction + approveChangeAction), memory management UI (/settings/memory — list/edit/delete/export/clear-all), privacy guardrails (validateMemoryText) |
| 6 | Goal-Based Planning | ✅ Done | All 6 tasks complete — goals schema + create_goal tool + /goals UI; budgets schema + propose_plan tool + plan_propose approval; budget review UI (/budgets); nightly goal_progress tracking job (cron, all goal kinds, anomaly detection); get_goal_progress read tool + GoalProgressWidget dashboard card |
| 7 | Installable PWA | ✅ Done | All build items complete — typed app/manifest.ts, app/maskable/Apple-touch icons, Serwist service worker (precache + runtime cache + navigation preload), /~offline fallback page, iOS install meta tags via Metadata API. Push/offline-writes/biometric-lock deferred per roadmap |
| 8 | Auth.js Migration | ✅ Done | Clerk replaced by Auth.js (NextAuth v5) Google SSO; identity owned in Postgres via Drizzle adapter (database sessions); auth_accounts/auth_sessions/auth_verification_tokens tables; clerk_id dropped; getCurrentUserId() helper replaces auth()+findUserByClerkId at all callsites; Auth.js middleware; AUTH_ALLOWED_EMAILS allowlist; Clerk webhook/sign-up/UserButton removed |

Status legend: 🔲 Not started · 🔄 In progress · ✅ Done · 🚧 Blocked

---

## Decisions Locked

These are set. Don't revisit without a strong reason.

- **Monorepo vs single Next.js app**: pnpm workspace active now; `apps/web/` holds all Phase 1–3 code; additional `packages/` extracted at Phase 4
- **Stack**: Next.js 15 + TypeScript + Tailwind + Drizzle + Neon + Auth.js (Google SSO) + Inngest + Vercel AI SDK
- **Primary AI model**: Claude Sonnet (reasoning/tools), `gpt-4o-mini` (enrichment), `text-embedding-3-small` (embeddings)
- **Money representation**: `bigint` cents — never float
- **Write pattern**: AI writes → `pending_changes` → user approval → `audit_events`
- **Memory store**: pgvector on same Neon Postgres — no separate vector DB
- **Out of scope for MVP**: tax optimization, retirement modeling, multi-tenant, native mobile
- **Auth provider**: **Auth.js (NextAuth) with Google SSO only** — replaces Clerk. Identity lives in our own Postgres; no third-party auth host. Household uses Google exclusively, so no passwords or magic-link email needed.
- **Hosted services kept**: Neon (DB), Vercel (hosting), Inngest (jobs), Sentry (errors). Deliberately *not* self-hosting a public-facing app — the only hosted dependency being dropped is Clerk. Connecting to the cloud DB during local dev is acceptable (no local Postgres swap).

---

## Open Decisions

Things not yet settled, to be resolved before or during the relevant phase.

| Decision | Needed By | Notes |
|----------|-----------|-------|
| ~~Auth.js vs Clerk~~ | ~~Phase 1 Task 2~~ | **Resolved (Phase 8): migrated to Auth.js (Google SSO only)**, dropping the hosted PII dependency. |
| Plaid Sandbox → Production timing | Phase 1 | Apply for Production access early (days of lead time) |
| ~~Category taxonomy (leaf count)~~ | ~~Phase 4~~ | **Resolved: 25-leaf taxonomy** — see `categorize.ts` `CATEGORY_TAXONOMY` |

---

## Blockers

None currently.

---

## How to Update This File

- When starting a phase: change status to 🔄, add a start date note
- When completing a phase: change to ✅, record any scope changes or learnings
- When a decision is made: move it from Open → Locked
- When a blocker appears: add it with owner + date
