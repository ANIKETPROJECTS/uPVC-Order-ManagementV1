import { Flag } from 'lucide-react';
import type { PaymentFlagStatus } from '@workspace/api-client-react';

export function PaymentFlagBadge({ status = 'active', count, label }: { status?: PaymentFlagStatus; count?: number; label?: string }) {
  if (status === 'removed') {
    return <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">Removed</span>;
  }
  const active = status === 'active';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${active ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`} data-testid={active ? 'badge-payment-flag-active' : 'badge-payment-flag-resolved'}>
    <Flag size={11} fill={active ? 'currentColor' : 'none'} />
    {label ?? (active ? 'Flagged' : 'Resolved')}{count && count > 1 ? ` · ${count}` : ''}
  </span>;
}