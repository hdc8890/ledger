import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest';
import { itemSync, balancesRefresh, investmentsRefresh } from '@/inngest';

// ---------------------------------------------------------------------------
// /api/inngest
//
// Inngest's HTTP endpoint for the Next.js App Router.
// GET  — Inngest Dev Server introspects functions.
// POST — Inngest platform invokes function runs.
// PUT  — Inngest Dev Server triggers syncs.
// ---------------------------------------------------------------------------
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [itemSync, balancesRefresh, investmentsRefresh],
});
