import { db } from '@/lib/db';
import { auditEvents } from '@/db/schema';

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

/**
 * Input for insertAuditEvent — all required fields except auto-generated id and at.
 */
export type InsertAuditEventInput = Omit<NewAuditEvent, 'id' | 'at'>;

/**
 * Append an immutable audit event to the log.
 *
 * Every AI write, user override, item connect/disconnect, and manual data
 * change must produce one of these rows. Non-negotiable per AGENTS.md §0.
 *
 * Usage:
 *   await insertAuditEvent({
 *     actor: userId,   // internal user UUID, or 'system' / 'ai'
 *     action: 'plaid.connect',
 *     entityType: 'plaid_item',
 *     entityId: item.id,
 *     before: null,
 *     after: { institutionName: item.institutionName },
 *     source: 'user',
 *     confidence: null,
 *   });
 */
export async function insertAuditEvent(input: InsertAuditEventInput): Promise<AuditEventRow> {
  const rows = await db.insert(auditEvents).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertAuditEvent: no row returned');
  return row;
}
