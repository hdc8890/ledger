/**
 * Central LLM provider factory.
 *
 * Inspired by orchestration-engine-v2's `services/llm.py`: one switch
 * (`LLM_*_PROVIDER`) selects between direct vendor SDKs and OpenAI-compatible
 * gateways (GitHub Models, OpenCode Go). All call sites go through the
 * helpers below so swapping providers is a config change, not a code change.
 *
 * Roles:
 *   - getChatModel()       — primary agent (defaults: anthropic / claude-sonnet-4-5)
 *   - getTitleModel()      — cheap chat-title generator (defaults: anthropic / claude-haiku-4-5)
 *   - getEnrichmentModel() — structured-output extraction (defaults: openai / gpt-4o-mini)
 *   - getEmbeddingModel()  — vector embeddings (defaults: openai / text-embedding-3-small)
 *
 * Supported providers (per role):
 *   - `anthropic`     — direct Anthropic API (ANTHROPIC_API_KEY)
 *   - `openai`        — direct OpenAI API (OPENAI_API_KEY)
 *   - `github-models` — GitHub Models gateway (OpenAI-compatible; GITHUB_TOKEN
 *                       with `models:read` scope). No LLM key required.
 *   - `opencode-go`   — local/remote OpenCode Go server (OpenAI-compatible).
 *
 * Embeddings are constrained to providers that expose a 1536-dim text model
 * compatible with `text-embedding-3-small` — the pgvector schema is locked
 * to 1536 dims. Changing this requires a migration.
 */

import type { EmbeddingModel, LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type ChatProvider = 'anthropic' | 'openai' | 'github-models' | 'opencode-go';
export type EmbeddingProvider = 'openai' | 'github-models' | 'opencode-go';

// ---------------------------------------------------------------------------
// Config — defaults preserve pre-refactor behavior.
// ---------------------------------------------------------------------------

const CHAT_PROVIDER = (process.env['LLM_CHAT_PROVIDER'] as ChatProvider) || 'anthropic';
const CHAT_MODEL = process.env['LLM_CHAT_MODEL'] ?? 'claude-sonnet-4-5';

const TITLE_PROVIDER = (process.env['LLM_TITLE_PROVIDER'] as ChatProvider) || CHAT_PROVIDER;
const TITLE_MODEL = process.env['LLM_TITLE_MODEL'] ?? 'claude-haiku-4-5';

const ENRICHMENT_PROVIDER =
  (process.env['LLM_ENRICHMENT_PROVIDER'] as ChatProvider) || 'openai';
const ENRICHMENT_MODEL = process.env['LLM_ENRICHMENT_MODEL'] ?? 'gpt-4o-mini';

const EMBEDDING_PROVIDER =
  (process.env['LLM_EMBEDDING_PROVIDER'] as EmbeddingProvider) || 'openai';
const EMBEDDING_MODEL = process.env['LLM_EMBEDDING_MODEL'] ?? 'text-embedding-3-small';

// GitHub Models endpoint (OpenAI-compatible). Override only if GH ever moves it.
const GITHUB_MODELS_ENDPOINT =
  process.env['GITHUB_MODELS_ENDPOINT'] ?? 'https://models.github.ai/inference';

// OpenCode Go endpoint — required when LLM_*_PROVIDER=opencode-go.
const OPENCODE_GO_ENDPOINT = process.env['OPENCODE_GO_ENDPOINT'] ?? '';
const OPENCODE_GO_API_KEY = process.env['OPENCODE_GO_API_KEY'] ?? 'opencode';

// ---------------------------------------------------------------------------
// OpenAI-compatible gateways (lazy, cached).
// ---------------------------------------------------------------------------

let _githubModels: ReturnType<typeof createOpenAICompatible> | null = null;
function githubModelsProvider() {
  if (_githubModels) return _githubModels;
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set — GitHub Models needs a PAT with 'models:read' scope.",
    );
  }
  _githubModels = createOpenAICompatible({
    name: 'github-models',
    baseURL: GITHUB_MODELS_ENDPOINT.replace(/\/$/, ''),
    apiKey: token,
  });
  return _githubModels;
}

let _opencodeGo: ReturnType<typeof createOpenAICompatible> | null = null;
function opencodeGoProvider() {
  if (_opencodeGo) return _opencodeGo;
  if (!OPENCODE_GO_ENDPOINT) {
    throw new Error(
      'OPENCODE_GO_ENDPOINT is not set — specify the OpenAI-compatible base URL ' +
        'of your OpenCode Go server (e.g. http://127.0.0.1:4000/v1).',
    );
  }
  // OpenCode Go's OpenAI-compatible endpoint already includes /v1; strip any
  // trailing /chat/completions a user may have pasted.
  let baseURL = OPENCODE_GO_ENDPOINT.replace(/\/$/, '');
  if (baseURL.endsWith('/chat/completions')) {
    baseURL = baseURL.slice(0, -'/chat/completions'.length);
  }
  _opencodeGo = createOpenAICompatible({
    name: 'opencode-go',
    baseURL,
    apiKey: OPENCODE_GO_API_KEY,
  });
  return _opencodeGo;
}

// ---------------------------------------------------------------------------
// Chat models
// ---------------------------------------------------------------------------

function resolveChat(provider: ChatProvider, model: string): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return anthropic(model);
    case 'openai':
      return openai(model);
    case 'github-models':
      return githubModelsProvider().chatModel(model);
    case 'opencode-go':
      return opencodeGoProvider().chatModel(model);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown chat provider: ${String(_exhaustive)}`);
    }
  }
}

/** Primary agent model (chat route, streaming + tools). */
export function getChatModel(): LanguageModel {
  return resolveChat(CHAT_PROVIDER, CHAT_MODEL);
}

/** Cheap model for fire-and-forget session titles. */
export function getTitleModel(): LanguageModel {
  return resolveChat(TITLE_PROVIDER, TITLE_MODEL);
}

/** Structured-output model used by enrichment + memory extraction. */
export function getEnrichmentModel(): LanguageModel {
  return resolveChat(ENRICHMENT_PROVIDER, ENRICHMENT_MODEL);
}

/** Model identifier strings — useful for `logLlmCall(... model)`. */
export const modelIds = {
  chat: CHAT_MODEL,
  title: TITLE_MODEL,
  enrichment: ENRICHMENT_MODEL,
  embedding: EMBEDDING_MODEL,
} as const;

/** Provider identifier strings — useful for cost attribution + logging. */
export const providerIds = {
  chat: CHAT_PROVIDER,
  title: TITLE_PROVIDER,
  enrichment: ENRICHMENT_PROVIDER,
  embedding: EMBEDDING_PROVIDER,
} as const;

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * Returns a 1536-dim text embedding model.
 *
 * The pgvector column (`memories.embedding`) is fixed at 1536 dims via the
 * Phase 5 migration. Whichever provider you choose must serve a model with
 * that dimensionality (default: `text-embedding-3-small`).
 */
export function getEmbeddingModel(): EmbeddingModel {
  switch (EMBEDDING_PROVIDER) {
    case 'openai':
      return openai.embedding(EMBEDDING_MODEL);
    case 'github-models':
      return githubModelsProvider().textEmbeddingModel(EMBEDDING_MODEL);
    case 'opencode-go':
      return opencodeGoProvider().textEmbeddingModel(EMBEDDING_MODEL);
    default: {
      const _exhaustive: never = EMBEDDING_PROVIDER;
      throw new Error(`Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}
