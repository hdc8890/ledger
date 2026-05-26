/**
 * Branded type helpers — prevent mixing domain IDs and primitives.
 *
 * Usage:
 *   const id = "abc" as UserId;
 *   function getUser(id: UserId) { ... }
 */

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type HouseholdId = Brand<string, 'HouseholdId'>;
export type PlaidItemId = Brand<string, 'PlaidItemId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type LiabilityId = Brand<string, 'LiabilityId'>;
export type NetWorthSnapshotId = Brand<string, 'NetWorthSnapshotId'>;
export type ChatSessionId = Brand<string, 'ChatSessionId'>;
export type ChatMessageId = Brand<string, 'ChatMessageId'>;
export type PendingChangeId = Brand<string, 'PendingChangeId'>;
export type LlmUsageId = Brand<string, 'LlmUsageId'>;
export type CategorizationRuleId = Brand<string, 'CategorizationRuleId'>;
export type MerchantAliasId = Brand<string, 'MerchantAliasId'>;
export type TransferLinkId = Brand<string, 'TransferLinkId'>;
export type RecurringSeriesId = Brand<string, 'RecurringSeriesId'>;

/** Cast a raw string to a branded type. Use at trust boundaries (DB reads, API input). */
export function brand<T extends Brand<string, string>>(value: string): T {
  return value as T;
}
