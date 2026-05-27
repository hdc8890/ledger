'use client';

import { useState, useTransition } from 'react';
import { updateMemoryAction, deleteMemoryAction, clearAllMemoriesAction } from '@/app/actions/memories';
import type { MemoryRow, MemoryKind } from '@/db/queries/memories';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<MemoryKind, string> = {
  preference: 'Preferences',
  household_rule: 'Household Rules',
  historical_context: 'Historical Context',
  goal: 'Goals',
  override_note: 'Override Notes',
};

const KIND_ORDER: readonly MemoryKind[] = [
  'household_rule',
  'preference',
  'goal',
  'override_note',
  'historical_context',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryManagerProps {
  initialMemories: MemoryRow[];
}

interface MemoryCardProps {
  memory: MemoryRow;
  onDeleted: (id: string) => void;
  onUpdated: (id: string, newText: string) => void;
}

// ---------------------------------------------------------------------------
// MemoryCard — single row with inline edit + delete
// ---------------------------------------------------------------------------

function MemoryCard({ memory, onDeleted, onUpdated }: MemoryCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(memory.text);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleEditClick() {
    setDraftText(memory.text);
    setError(null);
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
    setDraftText(memory.text);
    setError(null);
  }

  function handleSaveEdit() {
    if (!draftText.trim()) return;
    startTransition(async () => {
      const result = await updateMemoryAction(memory.id, draftText.trim());
      if (result.error) {
        setError(result.error);
      } else {
        onUpdated(memory.id, draftText.trim());
        setEditing(false);
        setError(null);
      }
    });
  }

  function handleDeleteClick() {
    setConfirmDelete(true);
  }

  function handleConfirmDelete() {
    startTransition(async () => {
      const result = await deleteMemoryAction(memory.id);
      if (result.error) {
        setError(result.error);
        setConfirmDelete(false);
      } else {
        onDeleted(memory.id);
      }
    });
  }

  const createdDate = new Date(memory.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      aria-label={`Memory: ${memory.text}`}
    >
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={3}
            autoFocus
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            aria-label="Edit memory text"
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={isPending || !draftText.trim()}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={isPending}
              className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-neutral-900 dark:text-neutral-100">{memory.text}</p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{createdDate}</p>
            {error && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs text-neutral-600 dark:text-neutral-400">Delete?</span>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isPending}
                  className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? '…' : 'Yes'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isPending}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleEditClick}
                  disabled={isPending}
                  className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  aria-label="Edit memory"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={isPending}
                  className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                  aria-label="Delete memory"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryManager — main component
// ---------------------------------------------------------------------------

/**
 * Client component for the Memory management page.
 *
 * Displays memories grouped by kind with inline edit and delete.
 * Provides "Export as JSON" and "Clear all" controls.
 */
export function MemoryManager({ initialMemories }: MemoryManagerProps) {
  const [memories, setMemories] = useState<MemoryRow[]>(initialMemories);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [isClearPending, startClearTransition] = useTransition();

  function handleDeleted(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  function handleUpdated(id: string, newText: string) {
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, text: newText } : m)));
  }

  function handleExport() {
    const exportData = memories.map(({ id, kind, text, metadata, confidence, createdAt }) => ({
      id,
      kind,
      text,
      metadata,
      confidence,
      createdAt,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ledger-memories.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClearAll() {
    setClearError(null);
    setConfirmClear(true);
  }

  function handleConfirmClear() {
    startClearTransition(async () => {
      const result = await clearAllMemoriesAction();
      if (result.error) {
        setClearError(result.error);
        setConfirmClear(false);
      } else {
        setMemories([]);
        setConfirmClear(false);
      }
    });
  }

  const grouped = KIND_ORDER.reduce<Record<MemoryKind, MemoryRow[]>>(
    (acc, kind) => {
      acc[kind] = memories.filter((m) => m.kind === kind);
      return acc;
    },
    {
      household_rule: [],
      preference: [],
      goal: [],
      override_note: [],
      historical_context: [],
    },
  );

  const hasMemories = memories.length > 0;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {hasMemories && (
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Export as JSON
          </button>
        )}

        {hasMemories && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  Delete all {memories.length} memories?
                </span>
                <button
                  type="button"
                  onClick={handleConfirmClear}
                  disabled={isClearPending}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isClearPending ? 'Deleting…' : 'Yes, delete all'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  disabled={isClearPending}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Clear all
              </button>
            )}
            {clearError && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {clearError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!hasMemories && (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No memories yet. Memories are created when you correct categories, approve asset
            updates, or accept suggestions from the AI chat.
          </p>
        </div>
      )}

      {/* Grouped sections */}
      {KIND_ORDER.map((kind) => {
        const items = grouped[kind];
        if (items.length === 0) return null;
        return (
          <section key={kind} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {KIND_LABELS[kind]}
              <span className="ml-2 text-xs font-normal normal-case text-neutral-400 dark:text-neutral-500">
                ({items.length})
              </span>
            </h2>
            <div className="space-y-2">
              {items.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  onDeleted={handleDeleted}
                  onUpdated={handleUpdated}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
