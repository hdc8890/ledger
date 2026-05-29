# AI Financial Operating System --- Product Roadmap

## Vision

Build a personal-first AI-powered financial operating system where
dashboards become passive views and a conversational AI agent becomes
the primary interface for actions, planning, summaries, and financial
intelligence.

Core philosophy:

-   Dashboards display state
-   Chat drives intent
-   AI manages context and memory
-   Manual overrides always win
-   Confidence scoring over false precision

------------------------------------------------------------------------

# Product Definition

Traditional finance apps:

User → Dashboard → Manual edits → Rules → Budgets

Target model:

User → Natural language request → Agent reasoning → Tool execution →
Memory learning

Examples:

-   "Create a budget that lets us save another \$1500/month"
-   "Why did our net worth drop this month?"
-   "Costco should mostly count as groceries"
-   "How much did we spend on vacations this year?"

------------------------------------------------------------------------

# High-Level System Architecture

External Sources - Plaid - Property valuation APIs - Vehicle valuation
APIs - Manual assets

↓

Ingestion Layer

↓

Normalization Layer

↓

AI Enrichment Layer

↓

Financial Agent Tool Layer

↓

Chat + Dashboards

------------------------------------------------------------------------

# Core Platform Components

## Financial Data Ingestion

Goals:

-   Connect institutions
-   Sync transactions
-   Sync balances
-   Support investments
-   Support loans
-   Support mortgages
-   Support manual assets

Initial integrations:

-   Plaid
-   Manual CSV imports
-   Manual assets

Future:

-   Multiple connectors
-   Backup aggregation providers

Challenges:

-   reconnect flows
-   duplicate transactions
-   delayed updates
-   institution failures

------------------------------------------------------------------------

## Asset System

Assets:

-   Home
-   Vehicles
-   Brokerage
-   Cash
-   Crypto
-   Manual assets

Example schema:

Home:

-   purchase price
-   mortgage balance
-   estimate source
-   manual override
-   confidence score

Vehicle:

-   VIN
-   trim
-   mileage
-   source estimate
-   manual override
-   confidence score

Rules:

1.  Manual overrides win
2.  External estimates are suggestions
3.  AI can suggest updates
4.  Confidence scores required

------------------------------------------------------------------------

# Dashboard Layer

Dashboards become state views only.

MVP dashboards:

## Net Worth

Display:

-   total net worth
-   trend line
-   asset composition
-   debt ratio

## Monthly Cash Flow

Display:

-   income
-   spending
-   savings

## Asset Tracking

Display:

-   home values
-   vehicle values
-   appreciation/depreciation

## Debt Dashboard

Display:

-   mortgage
-   loans
-   payoff trends

------------------------------------------------------------------------

# AI Agent Layer

Agent responsibilities:

-   answer questions
-   summarize activity
-   create budgets
-   edit data
-   generate insights
-   learn preferences

Primary interface:

Chat

------------------------------------------------------------------------

# Tool Layer

Agent tools:

get_transactions()

get_accounts()

get_assets()

query_transactions()

create_budget()

edit_budget()

update_asset()

calculate_networth()

forecast_cashflow()

create_rule()

save_memory()

------------------------------------------------------------------------

# AI Features

## Budget Creation

User:

"Create a budget that saves another \$1500 monthly"

Agent:

Analyze:

-   income
-   recurring expenses
-   trends
-   discretionary spending

Return:

Suggested plan + approval flow

------------------------------------------------------------------------

## Financial Summaries

Examples:

"Why did net worth change?"

"Summarize spending this month"

"What changed?"

Agent should provide reasoning rather than raw metrics.

------------------------------------------------------------------------

## Ad Hoc Analytics

Examples:

"How much did we spend at Costco?"

"How much have restaurants increased since last year?"

"How much did vacations cost?"

Agent dynamically queries data.

No custom dashboard required.

------------------------------------------------------------------------

## Categorization Intelligence

AI enrichment:

-   merchant normalization
-   category inference
-   transfer detection
-   recurring bills

Examples:

AMZN DIGITAL

→ Subscription

Costco

→ Groceries

Confidence scores included.

------------------------------------------------------------------------

# Memory System

Long-term memory becomes core product differentiation.

Examples:

-   Costco usually groceries
-   Home estimate manually set
-   Vacation expenses excluded from annual spending goals
-   Tesla spending changed transportation behavior

Memory categories:

User preferences

Household rules

Historical context

Financial goals

Manual overrides

------------------------------------------------------------------------

# MVP Roadmap

## Phase 1 --- Foundation

Duration: 1--2 weeks

Build:

-   authentication
-   Postgres
-   account model
-   transaction model
-   Plaid integration
-   sync jobs

Deliverable:

Unified financial data platform

------------------------------------------------------------------------

## Phase 2 --- Dashboard MVP

Duration: 1 week

Build:

-   net worth dashboard
-   cash flow dashboard
-   asset dashboard
-   debt dashboard

Deliverable:

Basic observability

------------------------------------------------------------------------

## Phase 3 --- AI Chat MVP

Duration: 1--2 weeks

Build:

-   tool calling
-   transaction querying
-   summaries
-   basic edits

Deliverable:

Chat-first financial interaction

------------------------------------------------------------------------

## Phase 4 --- AI Enrichment

Duration: 2 weeks

Build:

-   merchant normalization
-   categorization
-   recurring payment detection
-   confidence scoring

Deliverable:

Reduced manual work

------------------------------------------------------------------------

## Phase 5 --- Memory Layer

Duration: 1--2 weeks

Build:

-   user preference memory
-   household rules
-   override persistence

Deliverable:

Personalized agent behavior

------------------------------------------------------------------------

## Phase 6 --- Goal-Based Planning

Build:

Examples:

-   save for vehicle purchase
-   mortgage acceleration
-   spending reduction goals

Agent derives budgets automatically.

------------------------------------------------------------------------

## Phase 7 --- Installable PWA

Duration: ~0.5--1 week

Rationale:

Personal/family tool — no App Store distribution needed. A PWA gives
"Add to Home Screen" install, an app icon, and a standalone (chrome-less)
window on iOS/Android without a second codebase or rewriting the
RSC/Server Action data layer.

Build:

-   `app/manifest.ts` (typed web manifest: name, icons, theme, display:
    standalone)
-   App icons + maskable icons + Apple touch icons
-   Service worker via **Serwist** (`next-pwa` is unmaintained)
-   Offline fallback page; cache static shell, network-first for data
-   iOS install meta tags (`apple-mobile-web-app-*`)

Out of scope (defer to native if ever needed):

-   Push notifications (iOS requires installed PWA; background jobs run
    server-side via Inngest so the user pulls updates on open)
-   Offline-first writes / background sync
-   Biometric app-lock (Face ID)

Deliverable:

Installable home-screen app on mobile, single Next.js codebase.

------------------------------------------------------------------------

## Phase 8 --- Auth.js Migration (drop Clerk)

Duration: ~0.5--1 week

Rationale:

Remove the one hosted dependency that holds PII. Auth.js runs inside
the app and stores identity in our own Neon Postgres — no third-party
auth host. The household uses Google exclusively, so **Google SSO is
the only provider**: no password storage, no magic-link email/SMTP.

Other hosted services (Neon, Vercel, Inngest, Sentry) are kept
deliberately — not self-hosting a public-facing app.

Build:

-   Auth.js (NextAuth) with the Google provider + Drizzle adapter
    (sessions/accounts tables in Postgres)
-   Replace `clerkMiddleware` with Auth.js middleware; port the
    public-route matcher
-   Swap every `auth()` callsite (`@clerk/nextjs/server`) to the
    Auth.js session helper
-   Replace user provisioning: the Auth.js adapter creates the user
    row, so retire `/api/webhooks/clerk` and the dashboard-layout
    `upsertUserByClerkId` fallback
-   Migrate `users.clerkId` → provider account identity; keep internal
    UUID stable so all FKs are untouched
-   Remove `@clerk/nextjs`, Clerk env vars, and Clerk webhook config

Risks:

-   Existing `users` rows keyed on `clerkId` need a mapping path
-   Every protected route/action depends on the auth helper — broad
    but mechanical change surface

Deliverable:

Google SSO via Auth.js; zero Clerk dependency; identity owned in
Postgres.

------------------------------------------------------------------------

# Deliberately Avoid for MVP

Avoid:

-   tax optimization
-   advanced investment analytics
-   retirement modeling
-   predictive trading
-   complex forecasting
-   multi-user enterprise workflows

Reason:

These dramatically increase complexity while adding limited value early.

------------------------------------------------------------------------

# Technical Stack Proposal

Frontend:

-   React
-   Next.js
-   Tailwind

Backend:

-   FastAPI or Node
-   Postgres
-   Redis

AI:

-   existing orchestration engine
-   tool execution layer
-   long-term memory
-   LLM providers

Infrastructure:

-   containers
-   serverless jobs
-   scheduled sync workers

------------------------------------------------------------------------

# Long-Term Vision

Not:

"Monarch with AI"

Instead:

A personal AI financial operating system

Dashboards display state.

Agents execute intent.

Memory creates personalization.

Over time the system evolves from:

financial tracker

→ financial assistant

→ financial operator
