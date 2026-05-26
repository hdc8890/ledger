import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest';
import * as inngestFunctions from '@/inngest';

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
  functions: Object.values(inngestFunctions),
});
