interface ConfidenceChipProps {
  /** 0–1 confidence score. */
  confidence: number;
}

/**
 * RSC — amber chip displayed when confidence < 0.8, indicating the asset
 * value is an estimate rather than a confirmed figure.
 */
export function ConfidenceChip({ confidence }: ConfidenceChipProps) {
  if (confidence >= 0.8) return null;

  const pct = Math.round(confidence * 100);

  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      ~{pct}% confidence
    </span>
  );
}
