import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReturning, mockValues, mockInsert } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockReturning, mockValues, mockInsert };
});

vi.mock('@/lib/db', () => ({ db: { insert: mockInsert } }));
vi.mock('@/db/schema', () => ({ auditEvents: {} }));

import { insertAuditEvent } from '../audit-events';

const sample = {
  actor: 'clerk_user_123',
  action: 'plaid.connect',
  entityType: 'plaid_item',
  entityId: 'item-uuid',
  before: null,
  after: { institutionName: 'Test Bank' },
  source: 'user' as const,
  confidence: null,
};

const fullRow = {
  id: 'evt-uuid',
  ...sample,
  at: new Date(),
};

describe('insertAuditEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the inserted audit event row', async () => {
    mockReturning.mockResolvedValueOnce([fullRow]);
    const result = await insertAuditEvent(sample);
    expect(result).toEqual(fullRow);
    expect(mockValues).toHaveBeenCalledWith(sample);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(insertAuditEvent(sample)).rejects.toThrow('insertAuditEvent: no row returned');
  });

  it('accepts system actor for automated events', async () => {
    mockReturning.mockResolvedValueOnce([{ ...fullRow, actor: 'system' }]);
    await insertAuditEvent({ ...sample, actor: 'system' });
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ actor: 'system' }));
  });
});
