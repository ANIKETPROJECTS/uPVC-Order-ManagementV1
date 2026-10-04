import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, CircleAlert, Flag, LoaderCircle, Search, Trash2 } from 'lucide-react';
import {
  getListOrderActivityQueryKey,
  getListOrderPaymentFlagsQueryKey,
  getListPaymentFlagsQueryKey,
  useRemovePaymentFlag,
  useResolvePaymentFlag,
} from '@workspace/api-client-react';
import type { PaymentFlag, PaymentFlagStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { PaymentFlagBadge } from '@/components/payment-flag-badge';
import { PaymentProgressBar } from '@/components/payment-progress-bar';

const money = (amount: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(amount);

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const dateLabel = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const dateTimeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const flagTypeLabel = (type: PaymentFlag['flagType']) => type === 'bounced_payment' ? 'Bounced Payment' : 'Refusal to Pay';

export function FlaggedPaymentsSection({
  flags,
  canEdit,
  isLoading,
  isError,
  onRetry,
}: {
  flags: PaymentFlag[];
  canEdit: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const resolve = useResolvePaymentFlag();
  const remove = useRemovePaymentFlag();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [resolveTarget, setResolveTarget] = useState<PaymentFlag | null>(null);
  const [resolutionDate, setResolutionDate] = useState(today);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const activeFlags = useMemo(() => flags.filter((flag) => flag.status === 'active'), [flags]);
  const totalFlaggedAmount = useMemo(() => activeFlags.reduce((sum, flag) => sum + flag.flaggedAmount, 0), [activeFlags]);
  const clients = useMemo(() => [...new Set(flags.map((flag) => flag.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [flags]);
  const filteredFlags = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return flags.filter((flag) => {
      if (typeFilter !== 'all' && flag.flagType !== typeFilter) return false;
      if (statusFilter !== 'all' && flag.status !== statusFilter) return false;
      if (clientFilter !== 'all' && flag.clientName !== clientFilter) return false;
      if (dateFrom && flag.flaggedAt < dateFrom) return false;
      if (dateTo && flag.flaggedAt > dateTo) return false;
      if (!term) return true;
      return [
        flag.orderId,
        flag.clientName,
        flag.locationName,
        flag.remarks,
        flag.bounceReason ?? '',
        flag.followUpNotes ?? '',
        flag.flaggedBy,
      ].some((value) => value.toLocaleLowerCase().includes(term));
    });
  }, [clientFilter, dateFrom, dateTo, flags, search, statusFilter, typeFilter]);

  const refreshRelated = (flag: PaymentFlag) => {
    void queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(flag.orderRecordId) });
    void queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(flag.orderRecordId) });
  };

  const saveResolution = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolveTarget) return;
    resolve.mutate({ id: resolveTarget.id, data: { resolutionDate, resolutionNotes: resolutionNotes.trim() } }, {
      onSuccess: (updated) => {
        refreshRelated(updated);
        toast({ title: 'Payment flag resolved' });
        setResolveTarget(null);
      },
      onError: () => toast({ title: 'Payment flag could not be resolved', variant: 'destructive' }),
    });
  };

  const removeFlag = (flag: PaymentFlag) => {
    if (!window.confirm('Remove this flag from active tracking? Its action history will be retained.')) return;
    remove.mutate({ id: flag.id }, {
      onSuccess: (updated) => {
        refreshRelated(updated);
        toast({ title: 'Payment flag removed from active tracking' });
      },
      onError: () => toast({ title: 'Payment flag could not be removed', variant: 'destructive' }),
    });
  };

  return <div className="space-y-4" data-testid="section-flagged-payments">
    <section className="grid gap-3 sm:grid-cols-2" data-testid="summary-flagged-payments">
      <Card className="border-rose-200/80 bg-rose-50/60">
        <CardContent className="flex min-h-24 items-center justify-between p-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700">Active flags</p><p className="mt-1 font-display text-2xl font-bold text-rose-900" data-testid="value-active-payment-flags">{activeFlags.length}</p></div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-100 text-rose-700"><Flag size={18} /></span>
        </CardContent>
      </Card>
      <Card className="border-rose-200/80 bg-card">
        <CardContent className="flex min-h-24 items-center justify-between p-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Active flagged amount</p><p className="mt-1 font-display text-2xl font-bold" data-testid="value-active-flagged-amount">{money(totalFlaggedAmount)}</p></div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-foreground"><CircleAlert size={18} /></span>
        </CardContent>
      </Card>
    </section>

    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-display text-lg font-bold">Flagged Payments</h2><p className="mt-1 text-xs text-muted-foreground">Search, filter, resolve or remove payment issues. Removed records remain available here for audit.</p></div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold text-muted-foreground" data-testid="count-payment-flags">{filteredFlags.length} shown</span>
        </div>
      </div>
      <div className="grid gap-3 border-b border-border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-6" data-testid="filters-payment-flags">
        <label className="relative sm:col-span-2 lg:col-span-2">
          <span className="sr-only">Search flagged payments</span>
          <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search order, client or remarks" data-testid="input-search-payment-flags" />
        </label>
        <label>
          <span className="sr-only">Filter by flag type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs" data-testid="filter-payment-flag-type">
            <option value="all">All flag types</option><option value="bounced_payment">Bounced Payment</option><option value="refusal_to_pay">Refusal to Pay</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs" data-testid="filter-payment-flag-status">
            <option value="all">All statuses</option><option value="active">Active</option><option value="resolved">Resolved</option><option value="removed">Removed</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by client</span>
          <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs" data-testid="filter-payment-flag-client">
            <option value="all">All clients</option>{clients.map((client) => <option value={client} key={client}>{client}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-6">
          <label className="relative">
            <span className="sr-only">Flag date from</span><CalendarDays size={14} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="pl-9" aria-label="Flag date from" data-testid="filter-payment-flag-date-from" />
          </label>
          <label className="relative">
            <span className="sr-only">Flag date to</span><CalendarDays size={14} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="pl-9" aria-label="Flag date to" data-testid="filter-payment-flag-date-to" />
          </label>
        </div>
      </div>

      {isLoading ? <div className="space-y-3 p-5" data-testid="state-payment-flags-loading">{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-muted/60" />)}</div>
        : isError ? <div className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between" data-testid="state-payment-flags-error"><p className="text-sm text-muted-foreground">Flagged payment records could not be loaded.</p><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>
          : filteredFlags.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center" data-testid="state-payment-flags-empty"><span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground"><Flag size={17} /></span><p className="font-semibold">{flags.length ? 'No flags match these filters' : 'No flagged payments yet'}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{flags.length ? 'Adjust the search or filters to see other records.' : 'Use Flag from an order’s payment section to track a bounced payment or refusal to pay.'}</p></div>
            : <div className="divide-y divide-border/70">{filteredFlags.map((flag) => <FlaggedPaymentRow key={flag.id} flag={flag} canEdit={canEdit} onResolve={() => { setResolutionDate(today()); setResolutionNotes(''); setResolveTarget(flag); }} onRemove={() => removeFlag(flag)} />)}</div>}
    </section>

    {resolveTarget && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="resolve-payment-flag-title" data-testid="dialog-resolve-payment-flag">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Close the issue</p><h2 id="resolve-payment-flag-title" className="mt-1 font-display text-xl font-bold">Resolve flag</h2><p className="mt-1 text-xs text-muted-foreground">{resolveTarget.orderId} · {resolveTarget.clientName}</p></div><Button type="button" size="sm" variant="ghost" onClick={() => setResolveTarget(null)}>Close</Button></div>
        <form onSubmit={saveResolution} className="mt-5 space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Resolution date</span><Input type="date" required value={resolutionDate} onChange={(event) => setResolutionDate(event.target.value)} data-testid="input-payment-flag-resolution-date" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold">Resolution notes</span><Textarea required minLength={1} maxLength={1000} rows={3} value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} placeholder="Describe how the issue was resolved" data-testid="textarea-payment-flag-resolution-notes" /></label>
          <div className="flex justify-end gap-2 border-t border-border/70 pt-4"><Button type="button" variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button><Button type="submit" disabled={resolve.isPending} data-testid="button-confirm-payment-flag-resolution">{resolve.isPending && <LoaderCircle className="animate-spin" size={14} />} Mark resolved</Button></div>
        </form>
      </div>
    </div>}
  </div>;
}

function FlaggedPaymentRow({ flag, canEdit, onResolve, onRemove }: { flag: PaymentFlag; canEdit: boolean; onResolve: () => void; onRemove: () => void }) {
  const typeLabel = flagTypeLabel(flag.flagType);
  const statusLabel = flag.status === 'active' ? 'Active' : flag.status === 'resolved' ? 'Resolved' : 'Removed';
  return <article className="px-4 py-4 sm:px-5" data-testid={`row-payment-flag-${flag.id}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PaymentFlagBadge status={flag.status as PaymentFlagStatus} />
          <span className="text-xs font-bold">{typeLabel}</span>
          <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">{statusLabel}</span>
          <Link href={`/order-hub/${flag.orderRecordId}`} className="font-mono text-[11px] font-bold text-primary hover:underline" data-testid={`link-flag-order-${flag.id}`}>{flag.orderId}<ArrowRight size={11} className="ml-1 inline" /></Link>
        </div>
        <div><p className="text-sm font-semibold">{flag.clientName} <span className="font-normal text-muted-foreground">· {flag.locationName}</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{flag.remarks}</p>
          <div className="mt-2 max-w-sm space-y-1.5">
            <p className="text-[10px] text-muted-foreground">Paid {money(flag.paymentProgress?.paid ?? 0)} <span aria-hidden="true">·</span> Balance {flag.paymentProgress?.balance == null ? 'Unknown' : money(flag.paymentProgress.balance)}</p>
            <PaymentProgressBar percentage={flag.paymentProgress?.percentage ?? 0} compact testId={`progress-payment-flag-${flag.id}`} />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>Flagged {dateLabel(flag.flaggedAt)} by {flag.flaggedBy}</span>
          {flag.flagType === 'bounced_payment'
            ? <span>{flag.bounceReason} · Bank charges {flag.bankCharges == null ? '—' : money(flag.bankCharges)}</span>
            : <span>{flag.followUpCount} follow-ups · last on {flag.lastFollowUpDate ? dateLabel(flag.lastFollowUpDate) : '—'}</span>}
          {flag.resolutionDate && <span>Resolved {dateLabel(flag.resolutionDate)}</span>}
          {flag.removedAt && <span>Removed {dateTimeLabel(flag.removedAt)} by {flag.removedBy || 'Former user'}</span>}
        </div>
        {flag.followUpNotes && <p className="max-w-3xl text-[11px] leading-5 text-muted-foreground">{flag.followUpNotes}</p>}
        {flag.resolutionNotes && <p className="max-w-3xl rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-5"><span className="font-semibold">Resolution: </span>{flag.resolutionNotes}</p>}
        <details className="pt-1 text-[11px]">
          <summary className="w-fit cursor-pointer font-semibold text-primary">Action history ({flag.actions.length})</summary>
          <ol className="mt-2 space-y-2 border-l border-border pl-3">
            {flag.actions.map((action) => <li key={action.id} className="relative text-muted-foreground">
              <span className="font-semibold text-foreground">{action.action === 'created' ? 'Flag created' : action.action === 'resolved' ? 'Flag resolved' : 'Flag removed'}</span>
              <span> · {action.actorName} · {dateTimeLabel(action.occurredAt)}</span>
              <p className="mt-0.5 leading-4">{action.summary}</p>
            </li>)}
          </ol>
        </details>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
        <p className="font-display text-lg font-bold tabular-nums" data-testid={`value-payment-flag-amount-${flag.id}`}>{money(flag.flaggedAmount)}</p>
        {canEdit && flag.status !== 'removed' && <div className="flex items-center gap-1">
          {flag.status === 'active' && <Button size="sm" variant="outline" onClick={onResolve} data-testid={`button-resolve-payment-flag-${flag.id}`}>Mark resolved</Button>}
          <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" title="Remove flag; retain its audit history" aria-label={`Remove flag for ${flag.orderId}`} onClick={onRemove} data-testid={`button-remove-payment-flag-${flag.id}`}><Trash2 size={15} /></Button>
        </div>}
      </div>
    </div>
  </article>;
}