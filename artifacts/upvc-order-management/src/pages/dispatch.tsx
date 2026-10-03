import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ArrowDownUp,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  MapPin,
  PackageCheck,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import {
  DispatchStatus,
  getListDispatchOrdersQueryKey,
  useListDispatchOrders,
  useUpdateDispatchOrderStatus,
} from '@workspace/api-client-react';
import type { DispatchOrder, User } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getDispatchScanUrl } from '@/lib/order-qr';
import { useToast } from '@/hooks/use-toast';

type StatusValue = (typeof DispatchStatus)[keyof typeof DispatchStatus];
type SortValue = 'updated-desc' | 'updated-asc' | 'order-id' | 'client';

const STATUS_OPTIONS: { value: StatusValue; label: string; tone: string; dot: string }[] = [
  { value: DispatchStatus.pending_dispatch, label: 'Pending Dispatch', tone: 'bg-amber-100 text-amber-900 ring-amber-200', dot: 'bg-amber-500' },
  { value: DispatchStatus.dispatched, label: 'Dispatched', tone: 'bg-teal-100 text-teal-900 ring-teal-200', dot: 'bg-teal-600' },
  { value: DispatchStatus.delivered, label: 'Delivered', tone: 'bg-emerald-100 text-emerald-900 ring-emerald-200', dot: 'bg-emerald-600' },
];

const ORDER_STATUS_LABELS: Record<string, string> = {
  quotation_stage: 'Quotation stage',
  confirmed: 'Confirmed',
  in_production: 'In production',
  ready: 'Ready',
  dispatched: 'Dispatched',
  installed: 'Installed',
};

function dispatchLabel(status: string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status.replaceAll('_', ' ');
}

function orderTone(status: string) {
  const tones: Record<string, string> = {
    quotation_stage: 'bg-stone-100 text-stone-700',
    confirmed: 'bg-sky-100 text-sky-800',
    in_production: 'bg-orange-100 text-orange-900',
    ready: 'bg-lime-100 text-lime-900',
    dispatched: 'bg-violet-100 text-violet-800',
    installed: 'bg-emerald-100 text-emerald-900',
  };
  return tones[status] || 'bg-muted text-muted-foreground';
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Update time unavailable';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function SkeletonRows() {
  return <div className="space-y-2" aria-label="Loading dispatch orders" data-testid="state-dispatch-loading">
    {[0, 1, 2, 3].map((item) => <div key={item} className="grid animate-pulse grid-cols-1 gap-4 rounded-xl border border-border/70 bg-card p-4 md:grid-cols-[1.15fr_1fr_.9fr_1fr_auto] md:items-center">
      <div className="space-y-2"><div className="h-4 w-28 rounded bg-muted" /><div className="h-3 w-36 rounded bg-muted/70" /></div>
      <div className="h-4 w-32 rounded bg-muted/70" /><div className="h-6 w-24 rounded-full bg-muted/70" /><div className="h-4 w-28 rounded bg-muted/60" /><div className="h-8 w-24 rounded-lg bg-muted/70" />
    </div>)}
  </div>;
}

function StatusPill({ status }: { status: string }) {
  const option = STATUS_OPTIONS.find((item) => item.value === status);
  return <span className={`inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${option?.tone || 'bg-muted text-muted-foreground ring-border'}`} data-testid={`status-dispatch-${status}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${option?.dot || 'bg-muted-foreground'}`} />{dispatchLabel(status)}
  </span>;
}

function StatusDialog({ order, canEdit, busy, error, onClose, onSave }: {
  order: DispatchOrder | null;
  canEdit: boolean;
  busy: boolean;
  error: boolean;
  onClose: () => void;
  onSave: (id: string, status: StatusValue) => void;
}) {
  const [nextStatus, setNextStatus] = useState<StatusValue>(DispatchStatus.pending_dispatch);
  useEffect(() => {
    if (order) setNextStatus(order.dispatchStatus);
  }, [order]);
  const isOpen = Boolean(order);
  const changed = Boolean(order && nextStatus !== order.dispatchStatus);
  return <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Truck size={19} /></div>
        <DialogTitle>Update dispatch status</DialogTitle>
        <DialogDescription>{order ? `Change the delivery handoff for ${order.orderId}. Production status is shown separately and will not be changed.` : 'Choose a dispatch state.'}</DialogDescription>
      </DialogHeader>
      {order && <div className="space-y-4">
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
          <div className="font-mono text-sm font-bold tracking-tight">{order.orderId}</div>
          <div className="mt-1 text-xs text-muted-foreground">{order.clientName} <span className="px-1">·</span> {order.locationName}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill status={order.dispatchStatus} /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current</span></div>
        </div>
        {!canEdit ? <div className="flex gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-950"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><span>Your dispatch access is view-only. Ask an administrator for edit permission to make changes.</span></div> : <>
          <label className="block space-y-1.5 text-xs font-semibold text-foreground" htmlFor="dispatch-status-select">
            New dispatch status
            <select id="dispatch-status-select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as StatusValue)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium shadow-sm" data-testid="select-dispatch-status">
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive"><CircleAlert size={15} className="mt-0.5 shrink-0" />Status could not be saved. Check the connection and try again.</p>}
        </>}
      </div>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} data-testid="button-close-dispatch-dialog">Cancel</Button>
        {canEdit && order && <Button type="button" disabled={!changed || busy} onClick={() => onSave(order.id, nextStatus)} data-testid="button-save-dispatch-status">
          {busy ? 'Saving…' : <><Check size={15} /> Save status</>}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function DispatchPage({ user }: { user: User }) {
  const canView = user.roleId === 'master-admin'
    || user.permissions?.dispatch === 'view'
    || user.permissions?.dispatch === 'edit';
  const canEdit = user.roleId === 'master-admin' || user.permissions?.dispatch === 'edit';
  const canViewOrderHub = user.roleId === 'master-admin'
    || user.permissions?.['order-hub'] === 'view'
    || user.permissions?.['order-hub'] === 'edit';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const ordersQuery = useListDispatchOrders({
    query: { queryKey: getListDispatchOrdersQueryKey(), enabled: canView },
  });
  const updateStatus = useUpdateDispatchOrderStatus();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<SortValue>('updated-desc');
  const [activeOrder, setActiveOrder] = useState<DispatchOrder | null>(null);
  const [qrOrder, setQrOrder] = useState<DispatchOrder | null>(null);
  const handledScanRef = useRef<string | null>(null);

  const orders = ordersQuery.data || [];
  useEffect(() => {
    const recordId = new URLSearchParams(window.location.search).get('scanOrderId');
    if (!canView || !recordId || !ordersQuery.data || ordersQuery.isLoading || handledScanRef.current === recordId) return;
    handledScanRef.current = recordId;
    const match = ordersQuery.data.find((order) => order.id === recordId);
    if (match) {
      setActiveOrder(match);
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    } else {
      toast({ title: 'Order not found in dispatch', description: 'This QR code did not match a live dispatch record.' });
    }
  }, [canView, ordersQuery.data, ordersQuery.isLoading, toast]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const filtered = orders.filter((order) => {
      const matchesSearch = !needle || [order.orderId, order.clientName, order.locationName].some((value) => value.toLocaleLowerCase().includes(needle));
      return matchesSearch && (statusFilter === 'all' || order.dispatchStatus === statusFilter);
    });
    return filtered.sort((a, b) => {
      if (sort === 'updated-asc') return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      if (sort === 'order-id') return a.orderId.localeCompare(b.orderId, undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'client') return a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' });
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [orders, search, statusFilter, sort]);

  const countByStatus = (status: StatusValue) => orders.filter((order) => order.dispatchStatus === status).length;
  const saveStatus = (id: string, dispatchStatus: StatusValue) => {
    if (!canEdit) return;
    updateStatus.mutate({ id, data: { dispatchStatus } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData<DispatchOrder[]>(getListDispatchOrdersQueryKey(), (current) => current?.map((order) => order.id === updated.id ? updated : order));
        void queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
        toast({ title: 'Dispatch status updated', description: `${updated.orderId} · ${dispatchLabel(updated.dispatchStatus)}` });
        setActiveOrder(null);
      },
    });
  };
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); };

  return <AppShell user={user} title="Dispatch" eyebrow="Module · delivery handoff">
    <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <section className="order-hub-accent relative overflow-hidden rounded-2xl border border-primary/10 px-5 py-5 shadow-sm md:px-7 md:py-6">
        <div className="absolute -right-9 -top-16 h-56 w-56 rounded-full border border-primary/15" />
        <div className="absolute right-10 top-5 hidden h-24 w-24 rotate-12 rounded-2xl border border-accent/30 bg-white/10 md:block" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Framewise operations <span className="text-muted-foreground/70">/</span> dispatch desk</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em] text-foreground md:text-[2.65rem]">Every handoff, accounted for.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Find live orders quickly, confirm their delivery state, and keep dispatch separate from the production lifecycle.</p>
          </div>
          {canView && <Link href="/order-scanner?flow=dispatch" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" data-testid="link-dispatch-scanner">
            <QrCode size={15} /> Scan order QR <ArrowRight size={14} className="opacity-70" />
          </Link>}
        </div>
      </section>

      <section aria-label="Dispatch totals" className="grid grid-cols-3 gap-2 sm:gap-3">
        {STATUS_OPTIONS.map((option, index) => {
          const Icon = index === 0 ? Clock3 : index === 1 ? Truck : PackageCheck;
          return <button type="button" key={option.value} onClick={() => setStatusFilter(statusFilter === option.value ? 'all' : option.value)} className={`group rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:px-4 sm:py-4 ${statusFilter === option.value ? 'border-primary/40 ring-2 ring-primary/10' : 'border-border/80'}`} data-testid={`filter-dispatch-${option.value}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-bold uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px]">{option.label}</span><Icon size={15} className="shrink-0 text-primary/75" /></div>
            <div className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl" data-testid={`metric-dispatch-${option.value}`}>{ordersQuery.isLoading ? '—' : countByStatus(option.value)}</div>
            <div className="mt-1 hidden text-[10px] text-muted-foreground sm:block">{statusFilter === option.value ? 'Showing this stage' : 'Live records'}</div>
          </button>;
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="border-b border-border/75 p-4 md:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" /><h2 className="font-display text-lg font-bold tracking-tight">Dispatch register</h2><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground" data-testid="text-dispatch-count">{filteredOrders.length} / {orders.length}</span></div><p className="ml-3 mt-1 text-xs text-muted-foreground">Search by order, client, or delivery location.</p></div>
            {!canEdit && <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-900"><ShieldCheck size={13} /> View-only access</span>}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(200px,1fr)_190px_190px_auto]">
            <label className="relative block">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an order…" aria-label="Search by order, client, or location" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="input-dispatch-search" />
            </label>
            <label className="relative">
              <span className="sr-only">Filter dispatch status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-xs font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="select-dispatch-filter">
                <option value="all">All dispatch statuses</option>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ArrowDownUp size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </label>
            <label className="relative">
              <span className="sr-only">Sort dispatch orders</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortValue)} className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-xs font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" data-testid="select-dispatch-sort">
                <option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest update</option><option value="order-id">Order ID</option><option value="client">Client name</option>
              </select>
              <ArrowDownUp size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </label>
            {(search || statusFilter !== 'all') && <Button type="button" variant="ghost" size="sm" className="h-10 text-xs" onClick={clearFilters} data-testid="button-clear-dispatch-filters"><X size={14} /> Clear</Button>}
          </div>
        </div>

        <div className="hidden grid-cols-[1.15fr_1fr_.9fr_1fr_auto] gap-4 bg-muted/45 px-5 py-2.5 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground md:grid">
          <span>Order / client</span><span>Delivery location</span><span>Dispatch status</span><span>Order lifecycle</span><span className="text-right">Actions</span>
        </div>
        <div className="space-y-2 p-2 sm:p-3">
          {!canView ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-dispatch-access-denied">
            <div><ShieldCheck size={24} className="mx-auto text-muted-foreground" /><h3 className="mt-3 font-display text-sm font-bold">Dispatch access required</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Your role does not have permission to view dispatch records. Ask an administrator for dispatch access.</p></div>
          </div> : ordersQuery.isLoading ? <SkeletonRows /> : ordersQuery.isError ? <div className="grid min-h-64 place-items-center rounded-xl border border-destructive/20 bg-destructive/[0.035] p-6 text-center" data-testid="state-dispatch-error">
            <div><CircleAlert size={24} className="mx-auto text-destructive" /><h3 className="mt-3 font-display text-sm font-bold">Dispatch records unavailable</h3><p className="mt-1 text-xs text-muted-foreground">The latest handoff records could not be loaded.</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void ordersQuery.refetch()} data-testid="button-retry-dispatch"><RefreshCw size={13} /> Try again</Button></div>
          </div> : filteredOrders.length === 0 ? <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center" data-testid="state-dispatch-empty">
            <div><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-primary"><PackageCheck size={20} /></div><h3 className="mt-3 font-display text-sm font-bold">{orders.length ? 'No orders match these filters' : 'No dispatch records yet'}</h3><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{orders.length ? 'Try a different search or status filter, or clear your filters.' : 'Orders will appear here with a separate dispatch status so delivery handoffs can be tracked.'}</p>{orders.length > 0 && <Button type="button" size="sm" variant="outline" className="mt-4" onClick={clearFilters} data-testid="button-empty-clear-filters">Clear filters</Button>}</div>
          </div> : filteredOrders.map((order) => <article key={order.id} className="group grid gap-3 rounded-xl border border-border/75 bg-background px-3.5 py-3 transition duration-200 hover:border-primary/25 hover:bg-primary/[0.018] hover:shadow-sm md:grid-cols-[1.15fr_1fr_.9fr_1fr_auto] md:items-center md:gap-4 md:px-4" data-testid={`row-dispatch-order-${order.id}`}>
            <div className="min-w-0">
              {canViewOrderHub
                ? <Link href={`/order-status/${encodeURIComponent(order.id)}`} className="w-fit font-mono text-[13px] font-bold tracking-tight text-primary underline-offset-4 hover:underline" data-testid={`link-order-status-${order.id}`}>{order.orderId}</Link>
                : <span className="w-fit font-mono text-[13px] font-bold tracking-tight text-foreground" data-testid={`order-id-${order.id}`}>{order.orderId}</span>}
              <p className="mt-1 truncate text-xs font-semibold text-foreground">{order.clientName}</p>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><MapPin size={14} className="shrink-0 text-primary/70" /><span className="truncate">{order.locationName}</span></div>
            <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground md:hidden">Dispatch</span><StatusPill status={order.dispatchStatus} /></div>
            <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground md:hidden">Order stage</span><span className={`inline-flex w-fit rounded-md px-2 py-1 text-[10px] font-semibold ${orderTone(order.orderStatus)}`} data-testid={`status-order-${order.id}`}>{ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus.replaceAll('_', ' ')}</span></div>
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 md:justify-end md:border-0 md:pt-0">
              <span className="text-[10px] text-muted-foreground" title={formatUpdated(order.updatedAt)}>{formatUpdated(order.updatedAt)}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-[10px]" onClick={() => setQrOrder(order)} aria-label={`Show QR for ${order.orderId}`} data-testid={`button-show-qr-${order.id}`}><QrCode size={13} /><span className="hidden sm:inline">QR</span></Button>
                <Button type="button" size="sm" className="h-8 px-2.5 text-[10px]" disabled={!canEdit || updateStatus.isPending} onClick={() => setActiveOrder(order)} title={canEdit ? 'Change dispatch status' : 'View-only access'} data-testid={`button-change-status-${order.id}`}>{canEdit ? 'Update' : 'View'}<ArrowRight size={12} /></Button>
              </div>
            </div>
          </article>)}
        </div>
        {!ordersQuery.isLoading && !ordersQuery.isError && orders.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3 text-[10px] text-muted-foreground">
          <span>Updated records are shown first by default.</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> {filteredOrders.length} {filteredOrders.length === 1 ? 'record' : 'records'} in view</span>
        </div>}
      </section>
    </div>

    <StatusDialog order={activeOrder} canEdit={canEdit} busy={updateStatus.isPending} error={updateStatus.isError} onClose={() => { setActiveOrder(null); updateStatus.reset(); }} onSave={saveStatus} />
    <Dialog open={Boolean(qrOrder)} onOpenChange={(open) => { if (!open) setQrOrder(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Dispatch QR code</DialogTitle><DialogDescription>{qrOrder ? `Scan to open dispatch status for ${qrOrder.orderId}.` : 'Order dispatch QR code.'}</DialogDescription></DialogHeader>
        {qrOrder && <div className="flex flex-col items-center rounded-xl border border-border/70 bg-muted/20 p-5">
          <div className="rounded-xl bg-white p-3 shadow-sm"><QRCodeCanvas value={getDispatchScanUrl(qrOrder.id)} size={208} level="M" includeMargin /></div>
          <p className="mt-4 font-mono text-sm font-bold">{qrOrder.orderId}</p><p className="mt-1 text-xs text-muted-foreground">{qrOrder.clientName} · {qrOrder.locationName}</p><div className="mt-3"><StatusPill status={qrOrder.dispatchStatus} /></div>
          <p className="mt-3 max-w-[250px] text-center text-[10px] leading-4 text-muted-foreground">This code opens the dispatch status flow. Updating still requires dispatch edit permission.</p>
        </div>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setQrOrder(null)} data-testid="button-close-dispatch-qr">Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}