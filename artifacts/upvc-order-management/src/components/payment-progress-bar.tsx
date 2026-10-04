import { paymentProgressTone } from '@/lib/payment-progress';

export function PaymentProgressBar({
  percentage,
  compact = false,
  testId,
}: {
  percentage: number;
  compact?: boolean;
  testId: string;
}) {
  const safePercentage = Number.isFinite(percentage) ? percentage : 0;
  const fill = Math.max(0, Math.min(100, safePercentage));
  const label = `${safePercentage.toFixed(1)}% paid`;
  return <div className={compact ? 'flex min-w-28 items-center gap-2' : 'space-y-2'} data-testid={testId}>
    <div
      className={`w-full overflow-hidden rounded-full bg-muted ${compact ? 'h-1.5' : 'h-2.5'}`}
      role="progressbar"
      aria-label="Payment progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fill}
      aria-valuetext={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${paymentProgressTone(safePercentage)}`}
        style={{ width: `${fill}%` }}
      />
    </div>
    <span className={`shrink-0 tabular-nums ${compact ? 'text-[10px] font-semibold text-muted-foreground' : 'text-xs font-bold'}`}>
      {label}
    </span>
  </div>;
}