import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  Banknote,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  CreditCard,
  Grid2X2,
  List,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import {
  getGetBalancePaymentRegisterQueryKey,
  getGetBalancePaymentTransactionsQueryKey,
  useGetBalancePaymentRegister,
  useGetBalancePaymentTransactions,
} from '@workspace/api-client-react';
import type { BalancePaymentRegisterOrder, OrderPayment, OrderRefund, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { formatInr, formatIstDateTime } from '@/lib/formatters';

type PaymentState = 'all' | 'paid' | 'partial' | 'unpaid' | 'unpriced';
type SortKey = 'createdAt' | 'balance' | 'orderValue' | 'netPaid' | 'clientName' | 'orderId';
type LedgerEntry = { kind: 'receipt'; item: OrderPayment } | { kind: 'refund'; item: OrderRefund };

const lifecycleLabels: Record<string, string> = {
  quotation_stage: 'Quotation stage',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  dispatched: 'Dispatched',
  installed: 'Installed',
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
};

const methodLabel = (method: string) => method.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function getPaymentState(order: BalancePaymentRegisterOrder): Exclude<PaymentState, 'all'> {
  if (order.orderValue === null) return 'unpriced';
  if (order.balance !== null && order.balance <= 0) return 'paid';
  if (order.netPaid > 0) return 'partial';
  return 'unpaid';
}

function stateLabel(state: Exclude<PaymentState, 'all'>) {
  return ({ paid: 'Paid', partial: 'Partially paid', unpaid: 'Unpaid', unpriced: 'No order value' })[state];
}

function StateBadge({ state }: { state: Exclude<PaymentState, 'all'> }) {
  const styles = {
    paid: 'bg-primary/10 text-primary',
    partial: 'bg-amber-100 text-amber-800',
    unpaid: 'bg-rose-100 text-rose-800',
    unpriced: 'bg-muted text-muted-foreground',
  }[state];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${styles}`}><span className="size-1.5 rounded-full bg-current" />{stateLabel(state)}</span>;
}

function BalanceProgress({ order }: { order: BalancePaymentRegisterOrder }) {
  const percent = Math.max(0, Math.min(100, order.percentage));
  return <div className="mt-2.5">
    <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
      <span>Collected</span><span className="font-mono tabular-nums">{percent.toFixed(0)}%</span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  </div>;
}

function TransactionsPanel({ order }: { order: BalancePaymentRegisterOrder }) {
  const history = useGetBalancePaymentTransactions(order.orderRecordId, {
    query: {
      queryKey: getGetBalancePaymentTransactionsQueryKey(order.orderRecordId),
      enabled: true,
    },
  });
  const receipts = history.data?.receipts ?? [];
  const refunds = history.data?.refunds ?? [];
  const entries = useMemo(() => [
    ...receipts.map((item): LedgerEntry => ({ kind: 'receipt', item })),
    ...refunds.map((item): LedgerEntry => ({ kind: 'refund', item })),
  ].sort((a, b) => {
    const dateA = a.kind === 'receipt' ? a.item.paidAt : a.item.refundDate;
    const dateB = b.kind === 'receipt' ? b.item.paidAt : b.item.refundDate;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  }), [receipts, refunds]);

  if (history.isLoading) return <div className="space-y-2 p-4" aria-label="Loading payment history"><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-10 animate-pulse rounded-lg bg-muted/70" /></div>;
  if (history.isError) return <div className="flex items-center justify-between gap-3 p-4 text-xs text-destructive">
    <span className="inline-flex items-center gap-2"><CircleAlert size={14} /> History could not be loaded.</span>
    <Button size="sm" variant="outline" onClick={() => void history.refetch()}><RefreshCw size={13} className="mr-1.5" />Retry</Button>
  </div>;

  return <div className="border-t border-border bg-muted/20 px-4 py-4 sm:px-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-xs font-bold uppercase tracking-[0.12em]">All-time payment history</h3><p className="mt-1 text-[10px] text-muted-foreground">Order date filters do not limit this ledger.</p></div>
      <div className="flex gap-2 text-[10px]">
        <span className="rounded-md border border-border bg-card px-2 py-1 text-muted-foreground">{receipts.length} receipts</span>
        <span className="rounded-md border border-border bg-card px-2 py-1 text-muted-foreground">{refunds.length} refunds</span>
      </div>
    </div>
    {entries.length === 0 ? <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">No receipts or refunds recorded for this order.</div> : <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="min-w-[620px]">
        <div className="grid grid-cols-[minmax(125px,1fr)_minmax(110px,.8fr)_minmax(100px,.7fr)_minmax(120px,1fr)_minmax(130px,1.1fr)] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Type / status</span><span>Date</span><span>Amount</span><span>Method / reference</span><span>Notes / audit</span>
        </div>
        <div className="divide-y divide-border/70">
          {entries.map((entry) => entry.kind === 'receipt' ? <ReceiptRow key={`receipt-${entry.item.id}`} payment={entry.item} /> : <RefundRow key={`refund-${entry.item.id}`} refund={entry.item} />)}
        </div>
      </div>
    </div>}
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4 text-muted-foreground">
      <ShieldCheck size={12} className="text-primary" />
      <span>Net paid = received receipts − refunds.</span>
      <span>Voided and bounced receipts remain visible but do not count as paid.</span>
    </div>
  </div>;
}

function ReceiptRow({ payment }: { payment: OrderPayment }) {
  const statusStyle = payment.status === 'received' ? 'text-primary' : payment.status === 'void' ? 'text-muted-foreground' : 'text-rose-700';
  const detail = payment.status === 'void' ? payment.voidReason : payment.status === 'bounced' ? payment.bounceReason : payment.notes;
  return <div className="grid grid-cols-[minmax(125px,1fr)_minmax(110px,.8fr)_minmax(100px,.7fr)_minmax(120px,1fr)_minmax(130px,1.1fr)] gap-3 px-3 py-2.5 text-[10px]">
    <span className={`inline-flex items-start gap-1.5 font-semibold ${statusStyle}`}><Banknote size={12} className="mt-0.5 shrink-0" />Receipt · {payment.status}</span>
    <span className="text-muted-foreground">{formatIstDateTime(payment.paidAt)}</span>
    <span className={`font-mono font-bold tabular-nums ${payment.status === 'received' ? '' : 'text-muted-foreground line-through'}`}>{formatInr(payment.amount)}</span>
    <span className="text-muted-foreground">{methodLabel(payment.method)}{payment.reference ? <span className="block truncate font-mono text-[9px]">{payment.reference}</span> : null}</span>
    <span className="text-muted-foreground">{detail || '—'}<span className="block text-[9px]">Recorded by {payment.createdBy}{payment.status === 'bounced' && payment.bouncedBy ? ` · bounced by ${payment.bouncedBy}` : ''}</span></span>
  </div>;
}

function RefundRow({ refund }: { refund: OrderRefund }) {
  return <div className="grid grid-cols-[minmax(125px,1fr)_minmax(110px,.8fr)_minmax(100px,.7fr)_minmax(120px,1fr)_minmax(130px,1.1fr)] gap-3 px-3 py-2.5 text-[10px]">
    <span className="inline-flex items-start gap-1.5 font-semibold text-amber-800"><ArrowDown size={12} className="mt-0.5 shrink-0" />Refund</span>
    <span className="text-muted-foreground">{formatIstDateTime(refund.refundDate)}</span>
    <span className="font-mono font-bold tabular-nums text-amber-800">−{formatInr(refund.amount)}</span>
    <span className="text-muted-foreground">Refund</span>
    <span className="text-muted-foreground">{refund.notes || '—'}<span className="block text-[9px]">Recorded by {refund.createdBy}</span></span>
  </div>;
}

function OrderRow({ order, expanded, onToggle }: { order: BalancePaymentRegisterOrder; expanded: boolean; onToggle: () => void }) {
  const state = getPaymentState(order);
  return <article className="group border-b border-border/70 last:border-b-0" data-testid={`row-balance-order-${order.orderRecordId}`}>
    <div className="grid gap-3 px-4 py-4 transition-colors hover:bg-primary/[.025] sm:px-5 lg:grid-cols-[minmax(205px,1.35fr)_minmax(112px,.75fr)_minmax(110px,.8fr)_minmax(110px,.8fr)_minmax(105px,.75fr)_minmax(105px,.72fr)_minmax(86px,.65fr)] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/order-hub/${order.orderRecordId}`} className="font-mono text-xs font-bold text-primary hover:underline" data-testid={`link-balance-order-${order.orderRecordId}`}>{order.orderId}<ArrowRight size={11} className="ml-1 inline" /></Link>
          <StateBadge state={state} />
        </div>
        <p className="mt-1 truncate text-sm font-semibold">{order.clientName}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin size={11} />{order.locationName}</span><span aria-hidden="true">·</span><span>{lifecycleLabels[order.orderStatus] ?? order.orderStatus}</span></p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:block">
        <div><span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground lg:hidden">Order value</span><p className="font-mono text-xs font-semibold tabular-nums">{order.orderValue === null ? <span className="font-sans text-[10px] text-muted-foreground">Not set</span> : formatInr(order.orderValue)}</p></div>
        <div className="lg:hidden"><span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Net paid</span><p className="font-mono text-xs font-semibold tabular-nums">{formatInr(order.netPaid)}</p></div>
      </div>
      <div className="hidden lg:block"><p className="font-mono text-xs font-semibold tabular-nums">{formatInr(order.netPaid)}</p><p className="mt-1 text-[9px] text-muted-foreground">Net paid</p></div>
      <div><p className={`font-mono text-xs font-semibold tabular-nums ${order.balance !== null && order.balance > 0 ? 'text-amber-800' : ''}`}>{order.balance === null ? '—' : formatInr(order.balance)}</p><p className="mt-1 text-[9px] text-muted-foreground">Balance</p></div>
      <div><p className="text-[11px] font-semibold">{lifecycleLabels[order.orderStatus] ?? order.orderStatus}</p><p className="mt-1 text-[9px] text-muted-foreground">Lifecycle</p></div>
      <div><p className="text-[11px] font-medium">{formatDate(order.createdAt)}</p><p className="mt-1 text-[9px] text-muted-foreground">Order date</p></div>
      <div className="flex items-center justify-between gap-2 lg:justify-end">
        {order.orderValue !== null && <div className="w-20 lg:hidden"><BalanceProgress order={order} /></div>}
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[10px] font-semibold transition-colors ${expanded ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted'}`} data-testid={`button-history-${order.orderRecordId}`}>
          {expanded ? 'Hide history' : 'History'}<ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {order.orderValue !== null && <div className="hidden lg:block"><BalanceProgress order={order} /></div>}
    </div>
    {expanded && <TransactionsPanel order={order} />}
  </article>;
}

function OrderCard({ order, expanded, onToggle }: { order: BalancePaymentRegisterOrder; expanded: boolean; onToggle: () => void }) {
  const state = getPaymentState(order);
  return <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid={`card-balance-order-${order.orderRecordId}`}>
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><Link href={`/order-hub/${order.orderRecordId}`} className="font-mono text-xs font-bold text-primary hover:underline">{order.orderId}<ArrowRight size={11} className="ml-1 inline" /></Link><p className="mt-1 truncate text-sm font-semibold">{order.clientName}</p></div>
        <StateBadge state={state} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground"><MapPin size={11} />{order.locationName}<span aria-hidden="true">·</span>{lifecycleLabels[order.orderStatus] ?? order.orderStatus}</p>
      {order.orderValue !== null && <BalanceProgress order={order} />}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/70 pt-3">
        <div><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Order value</p><p className="mt-1 font-mono text-[11px] font-semibold">{order.orderValue === null ? 'Not set' : formatInr(order.orderValue)}</p></div>
        <div><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Net paid</p><p className="mt-1 font-mono text-[11px] font-semibold">{formatInr(order.netPaid)}</p></div>
        <div><p className="text-[9px] uppercase tracking-wide text-muted-foreground">Balance</p><p className="mt-1 font-mono text-[11px] font-semibold">{order.balance === null ? '—' : formatInr(order.balance)}</p></div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CalendarDays size={11} />{formatDate(order.createdAt)}</span>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-[10px] font-semibold hover:bg-muted" data-testid={`button-history-card-${order.orderRecordId}`}>{expanded ? 'Hide history' : 'View history'}<ChevronDown size={12} className={expanded ? 'rotate-180' : ''} /></button>
      </div>
    </div>
    {expanded && <TransactionsPanel order={order} />}
  </article>;
}

function RegisterSkeleton() {
  return <div className="space-y-3" data-testid="loading-balance-register">
    <div className="grid gap-3 sm:grid-cols-3"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted/80" /><div className="h-24 animate-pulse rounded-xl bg-muted/60" /></div>
    <div className="overflow-hidden rounded-xl border border-border bg-card p-4"><div className="mb-4 h-10 animate-pulse rounded-lg bg-muted" />{[0, 1, 2, 3, 4].map((row) => <div key={row} className="my-3 h-12 animate-pulse rounded-lg bg-muted/70" />)}</div>
  </div>;
}

export default function BalancePaymentPage({ user }: { user: User }) {
  const register = useGetBalancePaymentRegister({ query: { queryKey: getGetBalancePaymentRegisterQueryKey(), refetchOnWindowFocus: true } });
  const [search, setSearch] = useState('');
  const [paymentState, setPaymentState] = useState<PaymentState>('all');
  const [lifecycle, setLifecycle] = useState('all');
  const [location, setLocation] = useState('all');
  const [sortBy, setSortBy] = useState<SortKey>('createdAt');
  const [ascending, setAscending] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const orders = register.data ?? [];
  const locations = useMemo(() => [...new Set(orders.map((order) => order.locationName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [orders]);
  const lifecycles = useMemo(() => [...new Set(orders.map((order) => order.orderStatus))].sort(), [orders]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const start = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const end = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return orders.filter((order) => {
      const created = new Date(order.createdAt).getTime();
      const matchesQuery = !query || `${order.orderId} ${order.clientName} ${order.locationName}`.toLocaleLowerCase().includes(query);
      return matchesQuery
        && (paymentState === 'all' || getPaymentState(order) === paymentState)
        && (lifecycle === 'all' || order.orderStatus === lifecycle)
        && (location === 'all' || order.locationName === location)
        && (start === null || created >= start)
        && (end === null || created <= end);
    }).sort((a, b) => {
      const left = a[sortBy];
      const right = b[sortBy];
      let result = 0;
      if (typeof left === 'number' || typeof right === 'number') result = (left ?? Number.NEGATIVE_INFINITY) < (right ?? Number.NEGATIVE_INFINITY) ? -1 : (left ?? Number.NEGATIVE_INFINITY) > (right ?? Number.NEGATIVE_INFINITY) ? 1 : 0;
      else if (sortBy === 'createdAt') result = new Date(String(left)).getTime() - new Date(String(right)).getTime();
      else result = String(left ?? '').localeCompare(String(right ?? ''));
      return ascending ? result : -result;
    });
  }, [orders, search, paymentState, lifecycle, location, fromDate, toDate, sortBy, ascending]);

  const summary = useMemo(() => {
    const valued = filtered.filter((order) => order.orderValue !== null);
    return {
      orderCount: filtered.length,
      netPaid: filtered.reduce((sum, order) => sum + order.netPaid, 0),
      outstanding: filtered.reduce((sum, order) => sum + Math.max(0, order.balance ?? 0), 0),
      paidCount: filtered.filter((order) => getPaymentState(order) === 'paid').length,
      valuedCount: valued.length,
    };
  }, [filtered]);

  const resetFilters = () => {
    setSearch('');
    setPaymentState('all');
    setLifecycle('all');
    setLocation('all');
    setFromDate('');
    setToDate('');
  };

  return <AppShell user={user} title="Balance & payment register" eyebrow="Finance workspace">
    <main className="mx-auto w-full max-w-[1500px] space-y-5 pb-10" data-testid="page-balance-payment">
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card px-5 py-5 shadow-sm sm:px-7 sm:py-6" data-testid="panel-balance-register-intro">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border-[30px] border-primary/[.055]" />
        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[.07] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.16em] text-primary"><CreditCard size={12} /> All-order register</div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[32px]">Balance &amp; payment register</h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground">Every order, from first quotation through installed. Reconcile lifetime receipts and refunds against the order value.</p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-background/75 px-3 py-2 text-[10px] font-medium text-muted-foreground lg:self-auto"><ShieldCheck size={14} className="text-primary" />History is all-time; dates filter orders</div>
        </div>
      </section>

      {register.isLoading ? <RegisterSkeleton /> : register.isError ? <section className="rounded-xl border border-destructive/25 bg-card p-6" data-testid="state-balance-register-error">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex gap-3"><CircleAlert className="mt-0.5 text-destructive" size={19} /><div><h2 className="text-sm font-semibold">Register unavailable</h2><p className="mt-1 text-xs text-muted-foreground">Orders and balance data could not be loaded. Try again shortly.</p></div></div>
          <Button variant="outline" onClick={() => void register.refetch()} data-testid="button-retry-balance-register"><RefreshCw size={14} className="mr-2" />Retry</Button>
        </div>
      </section> : <>
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Filtered register summary">
          <div className="flex min-h-[94px] items-center justify-between rounded-xl border border-primary/15 bg-primary px-4 py-4 text-primary-foreground shadow-sm sm:px-5">
            <div><p className="text-[9px] font-bold uppercase tracking-[.14em] text-primary-foreground/70">Net paid · filtered</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{formatInr(summary.netPaid)}</p></div><span className="grid size-9 place-items-center rounded-lg bg-primary-foreground/15"><Wallet size={18} /></span>
          </div>
          <div className="flex min-h-[94px] items-center justify-between rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:px-5">
            <div><p className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">Outstanding · filtered</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{formatInr(summary.outstanding)}</p></div><span className="grid size-9 place-items-center rounded-lg bg-accent/20 text-accent-foreground"><ArrowDown size={17} /></span>
          </div>
          <div className="flex min-h-[94px] items-center justify-between rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:px-5">
            <div><p className="text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">Orders shown</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{summary.orderCount}<span className="ml-2 text-xs font-medium text-muted-foreground">{summary.paidCount} paid</span></p></div><span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Building2 size={17} /></span>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="section-balance-register">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
              <div><div className="flex items-center gap-2"><h2 className="font-display text-base font-bold">Order register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground" data-testid="count-balance-orders">{filtered.length}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{summary.valuedCount} orders with value · complete history available per order</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-[210px] flex-1 sm:flex-none"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, client, location" className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition focus:border-primary sm:w-[250px]" aria-label="Search orders" data-testid="input-search-balance-orders" /></label>
                <div className="inline-flex h-9 items-center rounded-lg border border-border bg-background p-0.5" aria-label="Register view">
                  <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} className={`grid size-8 place-items-center rounded-md ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-label="List view" data-testid="button-balance-list-view"><List size={15} /></button>
                  <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} className={`grid size-8 place-items-center rounded-md ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-label="Grid view" data-testid="button-balance-grid-view"><Grid2X2 size={14} /></button>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2.5">
              <label className="flex min-w-[145px] flex-1 flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground sm:flex-none"><span className="inline-flex items-center gap-1"><SlidersHorizontal size={11} />Payment state</span><select value={paymentState} onChange={(event) => setPaymentState(event.target.value as PaymentState)} className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" data-testid="select-balance-payment-state"><option value="all">All states</option><option value="paid">Paid</option><option value="partial">Partially paid</option><option value="unpaid">Unpaid</option><option value="unpriced">No order value</option></select></label>
              <label className="flex min-w-[145px] flex-1 flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground sm:flex-none"><span>Lifecycle</span><select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" data-testid="select-balance-lifecycle"><option value="all">All lifecycle stages</option>{lifecycles.map((status) => <option key={status} value={status}>{lifecycleLabels[status] ?? status}</option>)}</select></label>
              <label className="flex min-w-[135px] flex-1 flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground sm:flex-none"><span className="inline-flex items-center gap-1"><MapPin size={11} />Location</span><select value={location} onChange={(event) => setLocation(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" data-testid="select-balance-location"><option value="all">All locations</option>{locations.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
              <label className="flex min-w-[140px] flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground"><span className="inline-flex items-center gap-1"><CalendarDays size={11} />Order date from</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" aria-label="Created from date" data-testid="input-balance-date-from" /></label>
              <label className="flex min-w-[140px] flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground"><span>Order date to</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" aria-label="Created to date" data-testid="input-balance-date-to" /></label>
              <label className="flex min-w-[155px] flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground"><span className="inline-flex items-center gap-1"><ArrowDownUp size={11} />Sort orders</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)} className="h-8 rounded-md border border-input bg-background px-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary" data-testid="select-balance-sort"><option value="createdAt">Order date</option><option value="balance">Balance</option><option value="orderValue">Order value</option><option value="netPaid">Net paid</option><option value="clientName">Client name</option><option value="orderId">Order ID</option></select></label>
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-[10px]" onClick={() => setAscending((value) => !value)} aria-label={`Sort ${ascending ? 'descending' : 'ascending'}`} data-testid="button-balance-sort-direction">{ascending ? <ArrowUp size={13} className="mr-1" /> : <ArrowDown size={13} className="mr-1" />}{ascending ? 'Ascending' : 'Descending'}</Button>
              <button type="button" onClick={resetFilters} className="h-8 px-2 text-[10px] font-semibold text-primary hover:underline" data-testid="button-reset-balance-filters">Reset filters</button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-border bg-muted/25 px-4 py-2.5 text-[10px] text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-1.5"><Clock3 size={12} />{filtered.length} of {orders.length} orders · sorted by {({ createdAt: 'order date', balance: 'balance', orderValue: 'order value', netPaid: 'net paid', clientName: 'client name', orderId: 'order ID' })[sortBy]} {ascending ? 'ascending' : 'descending'}</span>
            <span className="hidden sm:inline">History remains all-time</span>
          </div>
          {filtered.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center" data-testid="state-no-balance-orders">
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Search size={18} /></span>
            <p className="text-sm font-semibold">No orders match these filters</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Change the order-date range or clear a filter to see more of the register.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={resetFilters}>Clear filters</Button>
          </div> : view === 'list' ? <>
            <div className="hidden grid-cols-[minmax(205px,1.35fr)_minmax(112px,.75fr)_minmax(110px,.8fr)_minmax(110px,.8fr)_minmax(105px,.75fr)_minmax(105px,.72fr)_minmax(86px,.65fr)] gap-3 border-b border-border bg-muted/35 px-5 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground lg:grid">
              <span>Order / client</span><span>Order value</span><span>Net paid</span><span>Balance</span><span>Lifecycle</span><span>Created</span><span>History</span>
            </div>
            {filtered.map((order) => <OrderRow key={order.orderRecordId} order={order} expanded={expandedId === order.orderRecordId} onToggle={() => setExpandedId((current) => current === order.orderRecordId ? null : order.orderRecordId)} />)}
          </> : <div className="grid gap-3 bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((order) => <OrderCard key={order.orderRecordId} order={order} expanded={expandedId === order.orderRecordId} onToggle={() => setExpandedId((current) => current === order.orderRecordId ? null : order.orderRecordId)} />)}
          </div>}
          {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-3 text-[10px] text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-1.5"><Check size={12} className="text-primary" />All lifecycle statuses included</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={12} />Dates apply to order creation only</span>
          </div>}
        </section>
      </>}
    </main>
  </AppShell>;
}
