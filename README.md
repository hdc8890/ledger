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
- **Auth** — Auth.js (NextAuth) · Google SSO
- **Hosting** — Vercel

---

## Status

Phases 1–6 complete (Foundation → Goal-Based Planning). See [`docs/STATUS.md`](./docs/STATUS.md) for current
phase and progress.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- A [Neon](https://neon.tech) Postgres project (pgvector is available by default)
- A Google Cloud project with OAuth 2.0 credentials (for Auth.js)
- [Plaid](https://plaid.com) sandbox credentials
- An LLM provider (see §5 below — zero-cost path available)

---

### 1. Clone and install

```bash
git clone https://github.com/hdc8890/ledger
cd ledger
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

---

### 2. Neon database

1. Create a free project at [console.neon.tech](https://console.neon.tech).
2. Copy the **Connection string** (with `?sslmode=require`) into `DATABASE_URL`.

> pgvector is pre-installed on Neon — no extra steps needed.

---

### 3. Google OAuth credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
4. Copy **Client ID** → `AUTH_GOOGLE_ID` and **Client Secret** → `AUTH_GOOGLE_SECRET`.
5. Set `AUTH_SECRET` to any random string (e.g. `openssl rand -base64 32`).

---

### 4. Plaid sandbox

1. Create an account at [dashboard.plaid.com](https://dashboard.plaid.com).
2. Under **Team Settings → Keys**, copy **Client ID** → `PLAID_CLIENT_ID` and
   **Sandbox secret** → `PLAID_SECRET`.
3. Leave `PLAID_ENV=sandbox`.

---

### 5. LLM providers

**Zero-cost option — OpenCode Go + GitHub Models:**

```env
LLM_CHAT_PROVIDER=opencode-go
LLM_CHAT_MODEL=glm-5.1               # or any model your account exposes
LLM_TITLE_PROVIDER=opencode-go
LLM_TITLE_MODEL=glm-5.1
LLM_ENRICHMENT_PROVIDER=opencode-go
LLM_ENRICHMENT_MODEL=glm-5.1
LLM_EMBEDDING_PROVIDER=github-models  # free 1536-dim embeddings via GitHub token
LLM_EMBEDDING_MODEL=text-embedding-3-small

OPENCODE_GO_ENDPOINT=https://opencode.ai/zen/go/v1/chat/completions
OPENCODE_GO_API_KEY=<your-opencode-go-key>   # https://opencode.ai
GITHUB_TOKEN=<PAT-with-models:read-scope>    # https://github.com/settings/tokens
```

**Direct provider option:**

```env
LLM_CHAT_PROVIDER=anthropic
LLM_ENRICHMENT_PROVIDER=openai
LLM_EMBEDDING_PROVIDER=openai

ANTHROPIC_API_KEY=<key>
OPENAI_API_KEY=<key>
```

> **Embedding constraint:** `memories.embedding` is fixed at 1536 dims in the
> schema. Whatever provider you use for `LLM_EMBEDDING_PROVIDER` must serve a
> 1536-dim model. `text-embedding-3-small` (OpenAI / GitHub Models) satisfies this.

---

### 6. Apply database migrations

```bash
pnpm --filter web db:migrate
```

Runs all migrations (Phases 1–6). Idempotent — safe to re-run.

---

### 7. Start dev services

Two processes need to run simultaneously:

```bash
# Terminal 1 — Inngest dev server (runs background jobs: enrichment, memory
# extraction, nightly goal-progress cron). Unauthenticated locally.
npx inngest-cli@latest dev

# Terminal 2 — Next.js app
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and you're in.
Your user row is provisioned automatically on first page load.

---

### 8. Webhook tunnel (Plaid sync)

Plaid transaction sync requires a public URL to deliver webhook events.
This is **optional for initial local setup** — the chat agent, dashboards, and
manual Plaid Link flow all work without it.

```bash
# ngrok
ngrok http 3000

# or cloudflared
cloudflared tunnel --url http://localhost:3000
```

Register the HTTPS tunnel URL in:

| Service | Path |
|---------|------|
| **Plaid** dashboard → Webhooks | `<tunnel>/api/plaid/webhook` |

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
