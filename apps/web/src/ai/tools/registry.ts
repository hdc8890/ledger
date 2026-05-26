import { tool } from 'ai';
import { handler as getAccountsHandler, inputSchema as getAccountsInput } from './get-accounts';
import { handler as getAssetsHandler, inputSchema as getAssetsInput } from './get-assets';
import {
  handler as getTransactionsHandler,
  inputSchema as getTransactionsInput,
} from './get-transactions';
import {
  handler as queryTransactionsHandler,
  inputSchema as queryTransactionsInput,
} from './query-transactions';
import {
  handler as calculateNetworthHandler,
  inputSchema as calculateNetworthInput,
} from './calculate-networth';
import {
  handler as summarizePeriodHandler,
  inputSchema as summarizePeriodInput,
} from './summarize-period';
import {
  handler as forecastCashflowHandler,
  inputSchema as forecastCashflowInput,
} from './forecast-cashflow';
import { handler as updateAssetHandler, inputSchema as updateAssetInput } from './update-asset';
import {
  handler as tagTransactionHandler,
  inputSchema as tagTransactionInput,
} from './tag-transaction';
import {
  handler as createRuleDraftHandler,
  inputSchema as createRuleDraftInput,
} from './create-rule-draft';
import {
  handler as saveMemoryHandler,
  inputSchema as saveMemoryInput,
} from './save-memory';
import {
  handler as deleteMemoryHandler,
  inputSchema as deleteMemoryInput,
} from './delete-memory';
import {
  handler as listMemoriesHandler,
  inputSchema as listMemoriesInput,
} from './list-memories';
import type { ToolContext } from './context';

/**
 * Build the tools object for a given user context.
 * Pass the returned object to streamText's `tools` parameter.
 *
 * Read tools execute immediately and return data.
 * Write tools insert a pending_changes proposal and return the proposal ID —
 * they never commit directly to live tables.
 */
export function buildTools(ctx: ToolContext) {
  return {
    // ------------------------------------------------------------------
    // Read tools
    // ------------------------------------------------------------------
    get_accounts: tool({
      description:
        "Return all of the user's bank/investment accounts with current balances. Call this to list account names, types, and balances.",
      inputSchema: getAccountsInput,
      execute: (input) => getAccountsHandler(input, ctx),
    }),

    get_assets: tool({
      description:
        "Return all of the user's assets (home, vehicles, brokerage, etc.) with current values. Includes confidence scores and whether the value is a manual override.",
      inputSchema: getAssetsInput,
      execute: (input) => getAssetsHandler(input, ctx),
    }),

    get_transactions: tool({
      description:
        'Return a paginated list of transactions with optional filters for date range, category, account, and amount. Use for looking up specific transactions or browsing recent activity.',
      inputSchema: getTransactionsInput,
      execute: (input) => getTransactionsHandler(input, ctx),
    }),

    query_transactions: tool({
      description:
        'Aggregate transactions by category, merchant, or calendar month. Use to answer spending questions like "how much did I spend on groceries?" or "top merchants this month". Never compute totals yourself — always call this tool.',
      inputSchema: queryTransactionsInput,
      execute: (input) => queryTransactionsHandler(input, ctx),
    }),

    calculate_networth: tool({
      description:
        "Calculate the user's net worth (total assets minus total liabilities) as of today or a past date. Always call this tool — never compute net worth yourself from account balances.",
      inputSchema: calculateNetworthInput,
      execute: (input) => calculateNetworthHandler(input, ctx),
    }),

    summarize_period: tool({
      description:
        'Summarize income, spending, and savings for an arbitrary date range, plus top spending categories and merchants. Use for monthly or custom-period summaries.',
      inputSchema: summarizePeriodInput,
      execute: (input) => summarizePeriodHandler(input, ctx),
    }),

    forecast_cashflow: tool({
      description:
        "Project cash flow (income, spending, savings) for the next N months based on recent history. Returns a confidence level. Use when the user asks 'what will I spend next month?' or similar forward-looking questions.",
      inputSchema: forecastCashflowInput,
      execute: (input) => forecastCashflowHandler(input, ctx),
    }),

    // ------------------------------------------------------------------
    // Write tools — return proposals; never commit directly
    // ------------------------------------------------------------------
    update_asset: tool({
      description:
        "Propose an update to an asset's value or name. Returns a proposal ID for the user to approve. Do not apply any change without presenting the approval card.",
      inputSchema: updateAssetInput,
      execute: (input) => updateAssetHandler(input, ctx),
    }),

    tag_transaction: tool({
      description:
        'Propose a category change for a specific transaction. Returns a proposal ID for the user to approve. Do not tag without presenting the approval card.',
      inputSchema: tagTransactionInput,
      execute: (input) => tagTransactionHandler(input, ctx),
    }),

    create_rule_draft: tool({
      description:
        'Propose a new categorization rule (e.g. "merchant contains Costco → Groceries"). Returns a proposal ID for the user to approve. Do not create the rule without presenting the approval card.',
      inputSchema: createRuleDraftInput,
      execute: (input) => createRuleDraftHandler(input, ctx),
    }),

    // ------------------------------------------------------------------
    // Memory tools — read/write the user's persistent memory store
    // ------------------------------------------------------------------
    save_memory: tool({
      description:
        'Persist a preference, rule, or fact about the user to long-term memory. Use when the user expresses a lasting preference or rule (e.g. "Costco is always groceries"). Text must be semantic — do not include raw dollar amounts, account numbers, or institution names.',
      inputSchema: saveMemoryInput,
      execute: (input) => saveMemoryHandler(input, ctx),
    }),

    delete_memory: tool({
      description:
        "Hard-delete a specific memory by its ID. Use when the user says 'forget that' or asks to remove a stored preference. This permanently removes the memory.",
      inputSchema: deleteMemoryInput,
      execute: (input) => deleteMemoryHandler(input, ctx),
    }),

    list_memories: tool({
      description:
        "Return a paginated list of the user's stored memories, optionally filtered by kind. Use to show the user what the agent remembers, or to find a memory ID before deleting it.",
      inputSchema: listMemoriesInput,
      execute: (input) => listMemoriesHandler(input, ctx),
    }),
  };
}

export type ToolRegistry = ReturnType<typeof buildTools>;
