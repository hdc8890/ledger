'use client';

import { useState, useTransition } from 'react';
import { CATEGORY_TAXONOMY } from '@/lib/enrich/categorize';
import { correctCategoryAction } from '@/app/actions/transactions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategorySource = 'user' | 'rule' | 'ai' | 'plaid' | null;

interface CategoryChipProps {
  transactionId: string;
  category: string | null;
  categorySource: CategorySource;
  categoryConfidence: number | null;
}

// ---------------------------------------------------------------------------
// Source metadata
// ---------------------------------------------------------------------------

const SOURCE_STYLES: Record<NonNullable<CategorySource>, { bg: string; text: string; label: string }> = {
  user: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-800 dark:text-blue-300',
    label: 'Manual',
  },
  rule: {
    bg: 'bg-violet-100 dark:bg-violet-900/30',
    text: 'text-violet-800 dark:text-violet-300',
    label: 'Rule',
  },
  ai: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-800 dark:text-amber-300',
    label: 'AI',
  },
  plaid: {
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    text: 'text-neutral-600 dark:text-neutral-400',
    label: 'Plaid',
  },
};

const UNCATEGORIZED_STYLE = {
  bg: 'bg-neutral-100 dark:bg-neutral-800',
  text: 'text-neutral-400 dark:text-neutral-500',
  label: '—',
};

/**
 * Describe why a transaction was assigned its category.
 * Used as the tooltip title on the source badge.
 */
function sourceTooltip(source: CategorySource, confidence: number | null): string {
  if (source === 'user') return 'You manually set this category.';
  if (source === 'rule') return 'Matched a categorization rule.';
  if (source === 'ai') {
    const pct = confidence != null ? ` (${Math.round(confidence * 100)}% confidence)` : '';
    return `AI inference${pct}. Click the category to correct it.`;
  }
  if (source === 'plaid') return 'Category provided by Plaid.';
  return 'No category assigned yet.';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CategoryChip — shows the current category with a source badge.
 * Clicking the chip opens an inline select to pick a new category,
 * which calls correctCategoryAction on the server.
 */
export function CategoryChip({
  transactionId,
  category,
  categorySource,
  categoryConfidence,
}: CategoryChipProps) {
  const [editing, setEditing] = useState(false);
  const [optimisticCategory, setOptimisticCategory] = useState(category);
  const [optimisticSource, setOptimisticSource] = useState(categorySource);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const displayCategory = optimisticCategory ?? 'Uncategorized';
  const displaySource = optimisticSource;
  const style = displaySource ? SOURCE_STYLES[displaySource] : UNCATEGORIZED_STYLE;
  const tooltip = sourceTooltip(displaySource, categoryConfidence);

  function handleChipClick() {
    if (displaySource === 'user') return; // already a manual override; no re-edit needed via chip
    setEditing(true);
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const chosen = e.target.value;
    if (!chosen) return;
    setEditing(false);

    const prev = { cat: optimisticCategory, src: optimisticSource };
    setOptimisticCategory(chosen);
    setOptimisticSource('user');
    setError(null);

    startTransition(async () => {
      const result = await correctCategoryAction(transactionId, chosen);
      if (result.error) {
        setOptimisticCategory(prev.cat);
        setOptimisticSource(prev.src);
        setError(result.error);
      }
    });
  }

  function handleBlur() {
    setEditing(false);
  }

  if (editing) {
    return (
      <select
        autoFocus
        className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        defaultValue=""
        onChange={handleSelectChange}
        onBlur={handleBlur}
        aria-label="Select category"
      >
        <option value="" disabled>
          Select…
        </option>
        {CATEGORY_TAXONOMY.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* Category name — clickable to correct (unless already user-set) */}
      <button
        type="button"
        onClick={handleChipClick}
        disabled={isPending}
        title={displaySource !== 'user' ? 'Click to correct category' : undefined}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity ${style.bg} ${style.text} ${
          displaySource !== 'user'
            ? 'cursor-pointer hover:opacity-80'
            : 'cursor-default'
        } ${isPending ? 'opacity-50' : ''}`}
      >
        {displayCategory}
      </button>

      {/* Source badge with tooltip explaining why */}
      {displaySource && (
        <span
          title={tooltip}
          className="cursor-help text-xs text-neutral-400 dark:text-neutral-500"
          aria-label={tooltip}
        >
          {SOURCE_STYLES[displaySource].label}
        </span>
      )}

      {/* Confidence badge for AI-inferred categories below 80% */}
      {displaySource === 'ai' && categoryConfidence != null && categoryConfidence < 0.8 && (
        <span
          className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
          title={`${Math.round(categoryConfidence * 100)}% confidence`}
        >
          ~{Math.round(categoryConfidence * 100)}%
        </span>
      )}

      {/* Inline error */}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
