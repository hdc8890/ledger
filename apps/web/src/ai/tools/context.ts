import type { UserId } from '@/shared/types';

/**
 * Context injected into every tool handler.
 * Carries the authenticated user ID so handlers can scope all DB queries.
 */
export type ToolContext = {
  readonly userId: UserId;
};
